import UIKit
import WebKit

@_silgen_name("app_built_with_ios26_sdk")
private func appBuiltWithIOS26SDK() -> Bool

/// Floating UIKit chrome for the web view switcher.
/// The web controller remains the source of truth and pushes snapshots here.
/// Requires iOS 26+ runtime and iOS 26+ SDK for Liquid Glass `UITabBar` pill geometry;
/// older OS versions or older SDK builds fall back to the web toolbar.
func makeNativeToolbarModule() -> (any IOSBridgeModule)? {
    guard #available(iOS 26.0, *), appBuiltWithIOS26SDK() else { return nil }
    if (Bundle.main.object(forInfoDictionaryKey: "UIDesignRequiresCompatibility") as? Bool) == true {
        return nil
    }
    return NativeToolbarHost()
}

/// A tab bar placed above the home indicator still inherits a large bottom
/// safe-area inset, which crushes the icon and title inside a short frame.
@available(iOS 26.0, *)
private final class FloatingTabBar: UITabBar {
    override var safeAreaInsets: UIEdgeInsets { .zero }
}

@available(iOS 26.0, *)
private enum BottomToolbarMetrics {
    static let itemWidth: CGFloat = 64
    /// Padding and borders around the web cells, on both sides together.
    static let webChrome: CGFloat = 28
    static let webHeight: CGFloat = 40 + webChrome
    /// UITabBar's liquid-glass pill is this much smaller than its layout frame.
    static let glassInsetWidth: CGFloat = 42
    static let glassInsetHeight: CGFloat = 21
    static var frameHeight: CGFloat { webHeight + glassInsetHeight }
    static func frameWidth(itemCount: Int) -> CGFloat {
        CGFloat(max(itemCount, 1)) * itemWidth + webChrome + glassInsetWidth
    }
}

@available(iOS 26.0, *)
private final class NativeToolbarHost: NSObject, IOSBridgeModule, UITabBarDelegate {
    let capability: String? = "view_switcher_toolbar"

    private weak var webView: WKWebView?
    private weak var controller: UIViewController?
    private weak var bridge: IOSBridge?

    private let bottomStack = UIStackView()
    private let tabBar = FloatingTabBar()
    private let topControl = UISegmentedControl()

    private var bottomVisible: Bool?
    private var topVisible: Bool?
    private var bottomAnimator: UIViewPropertyAnimator?
    private var topAnimator: UIViewPropertyAnimator?
    private var bottomSwitcherId: String?
    private var topSwitcherId: String?
    private var bottomActiveId: String?
    private var topActiveId: String?
    private var bottomInteractionEnabled = true
    private var topInteractionEnabled = true
    private var bottomIconNames: [String] = []
    private var topSegmentIds: [String] = []
    private var bottomActiveColorKey: String?
    private var topActiveColorKey: String?
    private var tabBarWidth: NSLayoutConstraint?
    private var isApplyingSync = false

    func canHandle(type: String) -> Bool {
        type == "view_switcher_toolbar.sync" || type == "view_switcher_toolbar.remove"
    }

    func didInstall(context: IOSBridgeHostContext) {
        webView = context.webView
        controller = context.viewController
        bridge = context.bridge
        installAttempts = 0
        installChrome()
    }

    func didUninstall() {
        bottomAnimator?.stopAnimation(true)
        topAnimator?.stopAnimation(true)
        bottomAnimator = nil
        topAnimator = nil
        bottomStack.removeFromSuperview()
        topControl.removeFromSuperview()
        bottomVisible = nil
        topVisible = nil
        bottomSwitcherId = nil
        topSwitcherId = nil
        bottomActiveId = nil
        topActiveId = nil
        webView = nil
        controller = nil
        bridge = nil
    }

    func handle(
        type: String,
        payload: [String: Any],
        context: IOSBridgeMessageContext,
        reply: IOSBridgeReply
    ) {
        if Thread.isMainThread {
            apply(type: type, body: payload)
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.apply(type: type, body: payload)
            }
        }
        reply.resolve(nil)
    }

    func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
        guard bottomInteractionEnabled, let switcherId = bottomSwitcherId else { return }
        guard let viewId = item.accessibilityIdentifier, !viewId.isEmpty, viewId != bottomActiveId else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        emit(["type": "select", "switcher_id": switcherId, "view_id": viewId])
    }

    private var installAttempts = 0

    private func installChrome() {
        guard let parent = webView?.superview ?? controller?.view else {
            installAttempts += 1
            if installAttempts < 10 {
                DispatchQueue.main.async { [weak self] in self?.installChrome() }
            }
            return
        }
        if bottomStack.superview != nil { return }

        bottomStack.axis = .horizontal
        bottomStack.alignment = .center
        bottomStack.spacing = 8
        bottomStack.translatesAutoresizingMaskIntoConstraints = false
        tabBar.delegate = self
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        tabBar.itemPositioning = .centered
        // The visible glass is inset inside UITabBar. The frame is larger so the
        // pill itself matches the web capsule, 64pt cells plus 14pt of chrome per side.
        let tabWidth = tabBar.widthAnchor.constraint(equalToConstant: BottomToolbarMetrics.frameWidth(itemCount: 3))
        tabWidth.isActive = true
        tabBarWidth = tabWidth
        bottomStack.addArrangedSubview(tabBar)

        topControl.translatesAutoresizingMaskIntoConstraints = false
        topControl.addTarget(self, action: #selector(handleSegmentChange), for: .valueChanged)
        bottomStack.alpha = 0
        topControl.alpha = 0
        bottomStack.isUserInteractionEnabled = false
        topControl.isUserInteractionEnabled = false

        parent.addSubview(bottomStack)
        parent.addSubview(topControl)

        let safe = parent.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            bottomStack.centerXAnchor.constraint(equalTo: parent.centerXAnchor),
            // The glass sits 10.5pt inside the frame, so the frame is closer to the
            // screen edge and the visible pill stays 12pt up.
            bottomStack.bottomAnchor.constraint(equalTo: parent.bottomAnchor, constant: -(12 - BottomToolbarMetrics.glassInsetHeight / 2)),
            tabBar.heightAnchor.constraint(equalToConstant: BottomToolbarMetrics.frameHeight),
            topControl.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
            topControl.topAnchor.constraint(equalTo: safe.topAnchor, constant: 12),
            topControl.heightAnchor.constraint(equalToConstant: 36)
        ])
    }

    private func apply(type: String, body: [String: Any]) {
        let switcherId = body["switcher_id"] as? String ?? ""
        if type == "view_switcher_toolbar.remove" {
            let animated = optionalBoolValue(body["animated"]) ?? true
            if switcherId == bottomSwitcherId {
                bottomSwitcherId = nil
                bottomActiveId = nil
                setBottomVisible(false, animated: animated)
            }
            if switcherId == topSwitcherId {
                topSwitcherId = nil
                topActiveId = nil
                setTopVisible(false, animated: animated)
            }
            return
        }
        guard type == "view_switcher_toolbar.sync" else { return }

        let layout = body["layout"] as? String ?? "bottom-floating"
        let items = body["items"] as? [[String: Any]] ?? []
        let activeId = body["active_id"] as? String ?? ""
        let activeColor = body["active_color"] as? [String: Any]
        let visible = boolValue(body["visible"])
        let interactionEnabled = boolValue(body["interaction_enabled"])

        if layout == "top-floating" {
            let shouldShow = visible && !items.isEmpty
            let animated = optionalBoolValue(body["animated"]) ?? (topVisible != nil)
            topSwitcherId = switcherId
            topActiveId = activeId
            topInteractionEnabled = interactionEnabled
            rebuildSegments(items: items, activeId: activeId)
            applyTopActiveColor(activeColor)
            setTopVisible(shouldShow, animated: animated)
            topControl.isUserInteractionEnabled = shouldShow && interactionEnabled
        } else {
            let animated = optionalBoolValue(body["animated"]) ?? (bottomVisible != nil)
            bottomSwitcherId = switcherId
            bottomActiveId = activeId
            bottomInteractionEnabled = interactionEnabled
            rebuildTabs(items: items, activeId: activeId)
            applyBottomActiveColor(activeColor)
            tabBar.isUserInteractionEnabled = interactionEnabled
            setBottomVisible(visible && !items.isEmpty, animated: animated)
        }
    }

    private func rebuildTabs(items: [[String: Any]], activeId: String) {
        let currentIds = tabBar.items?.compactMap(\.accessibilityIdentifier) ?? []
        let nextIds = items.compactMap { $0["id"] as? String }
        let nextIcons = items.map { $0["icon"] as? String ?? "" }
        if currentIds != nextIds {
            bottomIconNames = nextIcons
            tabBar.items = items.enumerated().map { index, item in
                let iconName = nextIcons[index]
                let image = iconName.isEmpty ? nil : UIImage(systemName: iconName)
                let tab = UITabBarItem(title: item["label"] as? String ?? "", image: image, tag: index)
                tab.accessibilityIdentifier = item["id"] as? String
                return tab
            }
            tabBarWidth?.constant = BottomToolbarMetrics.frameWidth(itemCount: items.count)
        } else if let tabs = tabBar.items, tabs.count == items.count {
            for (index, (tab, item)) in zip(tabs, items).enumerated() {
                let title = item["label"] as? String ?? ""
                if tab.title != title {
                    tab.title = title
                }
                let iconName = nextIcons[index]
                if index >= bottomIconNames.count || bottomIconNames[index] != iconName {
                    tab.image = iconName.isEmpty ? nil : UIImage(systemName: iconName)
                }
            }
            bottomIconNames = nextIcons
        }
        if let selected = tabBar.items?.first(where: { $0.accessibilityIdentifier == activeId }) {
            if tabBar.selectedItem !== selected {
                tabBar.selectedItem = selected
            }
        } else if tabBar.selectedItem != nil {
            tabBar.selectedItem = nil
        }
    }

    private func rebuildSegments(items: [[String: Any]], activeId: String) {
        let titles = items.map { $0["label"] as? String ?? "" }
        let ids = items.compactMap { $0["id"] as? String }
        topSegmentIds = ids
        let needsRebuild = topControl.numberOfSegments != titles.count
            || (0..<topControl.numberOfSegments).contains { topControl.titleForSegment(at: $0) != titles[$0] }
        if needsRebuild {
            topControl.removeAllSegments()
            for (index, title) in titles.enumerated() {
                topControl.insertSegment(withTitle: title, at: index, animated: false)
            }
        }
        if let index = ids.firstIndex(of: activeId) {
            if topControl.selectedSegmentIndex != index {
                isApplyingSync = true
                topControl.selectedSegmentIndex = index
                isApplyingSync = false
            }
        } else if topControl.selectedSegmentIndex != UISegmentedControl.noSegment {
            isApplyingSync = true
            topControl.selectedSegmentIndex = UISegmentedControl.noSegment
            isApplyingSync = false
        }
    }

    @objc private func handleSegmentChange() {
        guard !isApplyingSync, topInteractionEnabled, let switcherId = topSwitcherId else { return }
        let index = topControl.selectedSegmentIndex
        guard index >= 0, index < topSegmentIds.count else { return }
        let viewId = topSegmentIds[index]
        guard viewId != topActiveId else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        emit(["type": "select", "switcher_id": switcherId, "view_id": viewId])
    }

    private func setBottomVisible(_ visible: Bool, animated: Bool) {
        guard bottomVisible != visible else { return }
        let wasUnset = bottomVisible == nil
        bottomVisible = visible
        bottomAnimator = animate(
            bottomStack,
            currentAnimator: bottomAnimator,
            visible: visible,
            downward: true,
            animated: animated,
            prepareHiddenStart: wasUnset && visible && animated
        )
    }

    private func setTopVisible(_ visible: Bool, animated: Bool) {
        guard topVisible != visible else { return }
        let wasUnset = topVisible == nil
        topVisible = visible
        topAnimator = animate(
            topControl,
            currentAnimator: topAnimator,
            visible: visible,
            downward: false,
            animated: animated,
            prepareHiddenStart: wasUnset && visible && animated
        )
    }

    private func animate(
        _ view: UIView,
        currentAnimator: UIViewPropertyAnimator?,
        visible: Bool,
        downward: Bool,
        animated: Bool,
        prepareHiddenStart: Bool
    ) -> UIViewPropertyAnimator? {
        if let currentAnimator, currentAnimator.state == .active {
            currentAnimator.stopAnimation(false)
            currentAnimator.finishAnimation(at: .current)
        }
        let offset: CGFloat = downward ? 80 : -80
        let hidden = CGAffineTransform(translationX: 0, y: offset).scaledBy(x: 0.9, y: 0.9)
        view.isUserInteractionEnabled = visible
        let changes = {
            view.transform = visible ? .identity : hidden
            view.alpha = visible ? 1 : 0
        }
        guard animated else {
            changes()
            return nil
        }
        if prepareHiddenStart {
            view.superview?.layoutIfNeeded()
            view.transform = hidden
        }
        let animator = UIViewPropertyAnimator(
            duration: 0.3,
            controlPoint1: CGPoint(x: 0.4, y: 0),
            controlPoint2: CGPoint(x: 0.2, y: 1)
        )
        animator.addAnimations(changes)
        animator.startAnimation()
        return animator
    }

    private func emit(_ payload: [String: String]) {
        bridge?.emit(type: "view_switcher_toolbar.select", payload: payload)
    }

    private func colorKey(for dict: [String: Any]?) -> String? {
        guard let dict,
              let light = dict["light"] as? String,
              let dark = dict["dark"] as? String else {
            return nil
        }
        return "\(light)|\(dark)"
    }

    private func dynamicColor(from dict: [String: Any]?) -> UIColor? {
        guard let dict,
              let lightString = dict["light"] as? String,
              let darkString = dict["dark"] as? String,
              let lightColor = parseCSSColor(lightString),
              let darkColor = parseCSSColor(darkString) else {
            return nil
        }
        if lightString == darkString {
            return lightColor
        }
        return UIColor { traits in
            traits.userInterfaceStyle == .dark ? darkColor : lightColor
        }
    }

    private func applyBottomActiveColor(_ dict: [String: Any]?) {
        let nextKey = colorKey(for: dict)
        guard nextKey != bottomActiveColorKey else { return }
        bottomActiveColorKey = nextKey
        tabBar.tintColor = dynamicColor(from: dict)
    }

    private func applyTopActiveColor(_ dict: [String: Any]?) {
        let nextKey = colorKey(for: dict)
        guard nextKey != topActiveColorKey else { return }
        topActiveColorKey = nextKey
        if let color = dynamicColor(from: dict) {
            topControl.setTitleTextAttributes([.foregroundColor: color], for: .selected)
        } else {
            topControl.setTitleTextAttributes(nil, for: .selected)
        }
    }

    private func parseCSSColor(_ raw: String) -> UIColor? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if value.hasPrefix("#") {
            let hex = String(value.dropFirst())
            let expanded: String
            switch hex.count {
            case 3:
                expanded = hex.map { "\($0)\($0)" }.joined() + "ff"
            case 4:
                expanded = hex.map { "\($0)\($0)" }.joined()
            case 6:
                expanded = hex + "ff"
            case 8:
                expanded = hex
            default:
                return nil
            }
            guard let rgba = UInt64(expanded, radix: 16) else { return nil }
            let r = CGFloat((rgba & 0xff000000) >> 24) / 255.0
            let g = CGFloat((rgba & 0x00ff0000) >> 16) / 255.0
            let b = CGFloat((rgba & 0x0000ff00) >> 8) / 255.0
            let a = CGFloat(rgba & 0x000000ff) / 255.0
            return UIColor(red: r, green: g, blue: b, alpha: a)
        }

        let prefix: String
        if value.hasPrefix("rgba(") {
            prefix = "rgba("
        } else if value.hasPrefix("rgb(") {
            prefix = "rgb("
        } else {
            return nil
        }
        guard value.hasSuffix(")") else { return nil }
        let inner = value.dropFirst(prefix.count).dropLast()
        let parts = inner
            .replacingOccurrences(of: ",", with: " ")
            .replacingOccurrences(of: "/", with: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
        guard parts.count == 3 || parts.count == 4 else { return nil }

        func parseChannel(_ token: String, maxVal: CGFloat) -> CGFloat? {
            if token.hasSuffix("%"), let num = Double(token.dropLast()) {
                return min(max(CGFloat(num) / 100.0, 0), 1)
            }
            guard let num = Double(token) else { return nil }
            return min(max(CGFloat(num) / maxVal, 0), 1)
        }

        guard let r = parseChannel(parts[0], maxVal: 255),
              let g = parseChannel(parts[1], maxVal: 255),
              let b = parseChannel(parts[2], maxVal: 255) else {
            return nil
        }
        let a: CGFloat
        if parts.count == 4 {
            guard let parsedAlpha = parseChannel(parts[3], maxVal: 1) else { return nil }
            a = parsedAlpha
        } else {
            a = 1
        }
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }

    private func boolValue(_ value: Any?) -> Bool {
        optionalBoolValue(value) ?? false
    }

    private func optionalBoolValue(_ value: Any?) -> Bool? {
        (value as? NSNumber)?.boolValue
    }
}
