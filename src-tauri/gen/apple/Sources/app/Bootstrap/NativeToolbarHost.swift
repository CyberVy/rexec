import UIKit
import WebKit

/// Floating UIKit chrome for the web view switcher.
/// The web controller remains the source of truth and pushes snapshots here.
func installNativeToolbar(webView: WKWebView, controller: UIViewController) {
    let host = NativeToolbarHost(webView: webView, controller: controller)
    let content = webView.configuration.userContentController
    content.add(host, name: "viewSwitcherToolbar")
    content.addUserScript(
        WKUserScript(
            source: "window.__VIEW_SWITCHER_NATIVE_TOOLBAR__ = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
    )
    webView.evaluateJavaScript("window.__VIEW_SWITCHER_NATIVE_TOOLBAR__ = true;")
    NativeToolbarRegistry.host = host
}

private enum NativeToolbarRegistry {
    static var host: NativeToolbarHost?
}

/// A tab bar placed above the home indicator still inherits a large bottom
/// safe-area inset, which crushes the icon and title inside a short frame.
private final class FloatingTabBar: UITabBar {
    override var safeAreaInsets: UIEdgeInsets { .zero }
}

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

private final class NativeToolbarHost: NSObject, WKScriptMessageHandler, UITabBarDelegate {
    private weak var webView: WKWebView?
    private weak var controller: UIViewController?

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
    private var tabBarWidth: NSLayoutConstraint?
    private var isApplyingSync = false

    init(webView: WKWebView, controller: UIViewController) {
        self.webView = webView
        self.controller = controller
        super.init()
        installChrome()
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "viewSwitcherToolbar", let body = message.body as? [String: Any] else { return }
        if Thread.isMainThread {
            apply(body)
        } else {
            DispatchQueue.main.async { [weak self] in
                self?.apply(body)
            }
        }
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

    private func apply(_ body: [String: Any]) {
        let type = body["type"] as? String ?? ""
        let switcherId = body["switcher_id"] as? String ?? ""
        if type == "remove" {
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
        guard type == "sync" else { return }

        let layout = body["layout"] as? String ?? "bottom-floating"
        let items = body["items"] as? [[String: Any]] ?? []
        let activeId = body["active_id"] as? String ?? ""
        let visible = boolValue(body["visible"])
        let interactionEnabled = boolValue(body["interaction_enabled"])

        if layout == "top-floating" {
            let shouldShow = visible && !items.isEmpty
            let animated = optionalBoolValue(body["animated"]) ?? (topVisible != nil)
            topSwitcherId = switcherId
            topActiveId = activeId
            topInteractionEnabled = interactionEnabled
            rebuildSegments(items: items, activeId: activeId)
            setTopVisible(shouldShow, animated: animated)
            topControl.isUserInteractionEnabled = shouldShow && interactionEnabled
        } else {
            let animated = optionalBoolValue(body["animated"]) ?? (bottomVisible != nil)
            bottomSwitcherId = switcherId
            bottomActiveId = activeId
            bottomInteractionEnabled = interactionEnabled
            rebuildTabs(items: items, activeId: activeId)
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
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.__view_switcher_native_toolbar_dispatch?.(\(json))")
    }

    private func boolValue(_ value: Any?) -> Bool {
        optionalBoolValue(value) ?? false
    }

    private func optionalBoolValue(_ value: Any?) -> Bool? {
        (value as? NSNumber)?.boolValue
    }
}
