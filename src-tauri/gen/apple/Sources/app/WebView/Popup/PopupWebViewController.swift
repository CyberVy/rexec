import UIKit
import WebKit

final class PopupWebViewController: UIViewController, WKNavigationDelegate, UIGestureRecognizerDelegate {
    private let closeSwipeProgressThreshold: CGFloat = 0.5
    private let closeSwipeMaxDistanceThreshold: CGFloat = 240
    private let toolbarHorizontalInset: CGFloat = 14
    private let toolbarBottomSpacing: CGFloat = 12
    private let toolbarContentInset = NSDirectionalEdgeInsets(top: 10, leading: 12, bottom: 10, trailing: 12)
    private let toolbarButtonSize: CGFloat = 36
    private let popupWebView: WKWebView
    private let toolbarView = UIVisualEffectView(effect: UIBlurEffect(style: .systemChromeMaterial))
    private let titleLabel = UILabel()
    private let navButtons = UIStackView()
    private let contentStack = UIStackView()
    private var titleMinimumWidthConstraint: NSLayoutConstraint?
    private var isToolbarCollapsed = false
    private var observations: [NSKeyValueObservation] = []
    private lazy var closeButton = makeToolbarButton(symbolName: "xmark", action: #selector(closeTapped))
    private lazy var backButton = makeToolbarButton(symbolName: "chevron.left", action: #selector(goBack))
    private lazy var forwardButton = makeToolbarButton(symbolName: "chevron.right", action: #selector(goForward))
    private lazy var collapseButton = makeToolbarButton(symbolName: "chevron.down", action: #selector(toggleToolbarCollapsed))
    private let closeOnEdgeSwipeGesture = UIScreenEdgePanGestureRecognizer()

    init(webView: WKWebView) {
        self.popupWebView = webView
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        setupObservations()
        applyNoFlickerStyle(to: popupWebView, in: self)
        popupWebView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(popupWebView)
        NSLayoutConstraint.activate([
            popupWebView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            popupWebView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            popupWebView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            popupWebView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        configureToolbar()
        updateWebViewInsets()
        closeOnEdgeSwipeGesture.edges = .left
        closeOnEdgeSwipeGesture.delegate = self
        closeOnEdgeSwipeGesture.cancelsTouchesInView = false
        closeOnEdgeSwipeGesture.addTarget(self, action: #selector(handleCloseOnEdgeSwipe(_:)))
        view.addGestureRecognizer(closeOnEdgeSwipeGesture)
        updateNavigationButtons()
        updateDisplayedTitle()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        updateWebViewInsets()
    }

    @objc private func closeTapped() {
        dismiss(animated: true)
    }

    @objc private func goBack() {
        popupWebView.goBack()
    }

    @objc private func goForward() {
        popupWebView.goForward()
    }

    @objc private func toggleToolbarCollapsed() {
        isToolbarCollapsed.toggle()
        applyToolbarCollapsedState(animated: true)
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === closeOnEdgeSwipeGesture else { return true }
        // Only enable the close swipe when there is no web history to go back to.
        return !popupWebView.canGoBack
    }

    @objc private func handleCloseOnEdgeSwipe(_ recognizer: UIScreenEdgePanGestureRecognizer) {
        // Re-check at trigger time in case navigation state changed mid-gesture.
        guard !popupWebView.canGoBack else { return }

        let container: UIView = navigationController?.view ?? self.view
        let width = max(container.bounds.width, 1)
        let translationX = max(recognizer.translation(in: container).x, 0)
        let progress = min(translationX / width, 1)

        switch recognizer.state {
        case .began, .changed:
            container.transform = CGAffineTransform(translationX: translationX, y: 0)
            container.alpha = 1 - (0.25 * progress)

        case .ended:
            let closeDistance = min(width * closeSwipeProgressThreshold, closeSwipeMaxDistanceThreshold)
            if translationX >= closeDistance {
                animateSwipeContainer(container, x: width, alpha: 0.75, duration: 0.2) { [weak self] in
                    self?.dismiss(animated: false) {
                        container.transform = .identity
                        container.alpha = 1
                    }
                }
            } else {
                animateSwipeContainer(container, x: 0, alpha: 1, duration: 0.22)
            }

        case .cancelled, .failed:
            animateSwipeContainer(container, x: 0, alpha: 1, duration: 0.18)

        default:
            break
        }
    }

    private func animateSwipeContainer(_ container: UIView, x: CGFloat, alpha: CGFloat, duration: TimeInterval, completion: (() -> Void)? = nil) {
        UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
            container.transform = CGAffineTransform(translationX: x, y: 0)
            container.alpha = alpha
        } completion: { _ in
            completion?()
        }
    }

    private func setupObservations() {
        observations = [
            popupWebView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in
                self?.updateNavigationButtons()
            },
            popupWebView.observe(\.canGoForward, options: [.new]) { [weak self] _, _ in
                self?.updateNavigationButtons()
            },
            popupWebView.observe(\.title, options: [.new]) { [weak self] _, _ in
                self?.updateDisplayedTitle()
            },
            popupWebView.observe(\.url, options: [.new]) { [weak self] _, _ in
                self?.updateDisplayedTitle()
            }
        ]
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        // KVO handles UI updates
    }

    // Use WebKit's internal "allow without App Link" policy to keep Universal Links in-app.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 preferences: WKWebpagePreferences,
                 decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void) {
        decisionHandler(allowWithoutTryingAppLinkPolicy(), preferences)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // KVO handles UI updates
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        // KVO handles UI updates
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // KVO handles UI updates
    }

    private func updateNavigationButtons() {
        updateButtonState(backButton, enabled: popupWebView.canGoBack)
        updateButtonState(forwardButton, enabled: popupWebView.canGoForward)
    }

    private func configureToolbar() {
        toolbarView.translatesAutoresizingMaskIntoConstraints = false
        toolbarView.layer.cornerRadius = 22
        toolbarView.layer.cornerCurve = .continuous
        toolbarView.layer.masksToBounds = true
        toolbarView.layer.borderWidth = 1 / UIScreen.main.scale
        toolbarView.layer.borderColor = UIColor.white.withAlphaComponent(0.18).cgColor

        let blurEffect = (toolbarView.effect as? UIBlurEffect) ?? UIBlurEffect(style: .systemChromeMaterial)
        let vibrancyView = UIVisualEffectView(effect: UIVibrancyEffect(blurEffect: blurEffect))
        vibrancyView.translatesAutoresizingMaskIntoConstraints = false
        toolbarView.contentView.addSubview(vibrancyView)
        NSLayoutConstraint.activate([
            vibrancyView.leadingAnchor.constraint(equalTo: toolbarView.contentView.leadingAnchor),
            vibrancyView.trailingAnchor.constraint(equalTo: toolbarView.contentView.trailingAnchor),
            vibrancyView.topAnchor.constraint(equalTo: toolbarView.contentView.topAnchor),
            vibrancyView.bottomAnchor.constraint(equalTo: toolbarView.contentView.bottomAnchor)
        ])

        navButtons.axis = .horizontal
        navButtons.alignment = .center
        navButtons.spacing = 8
        navButtons.translatesAutoresizingMaskIntoConstraints = false
        navButtons.addArrangedSubview(backButton)
        navButtons.addArrangedSubview(forwardButton)

        titleLabel.font = .preferredFont(forTextStyle: .subheadline)
        titleLabel.textAlignment = .center
        titleLabel.textColor = .label
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        titleLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)

        contentStack.axis = .horizontal
        contentStack.alignment = .center
        contentStack.spacing = 12
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        contentStack.addArrangedSubview(closeButton)
        contentStack.addArrangedSubview(titleLabel)
        contentStack.addArrangedSubview(navButtons)
        contentStack.addArrangedSubview(collapseButton)

        vibrancyView.contentView.addSubview(contentStack)
        view.addSubview(toolbarView)

        NSLayoutConstraint.activate([
            toolbarView.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: toolbarHorizontalInset),
            toolbarView.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -toolbarHorizontalInset),
            toolbarView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            toolbarView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -toolbarBottomSpacing),

            contentStack.leadingAnchor.constraint(equalTo: vibrancyView.contentView.leadingAnchor, constant: toolbarContentInset.leading),
            contentStack.trailingAnchor.constraint(equalTo: vibrancyView.contentView.trailingAnchor, constant: -toolbarContentInset.trailing),
            contentStack.topAnchor.constraint(equalTo: vibrancyView.contentView.topAnchor, constant: toolbarContentInset.top),
            contentStack.bottomAnchor.constraint(equalTo: vibrancyView.contentView.bottomAnchor, constant: -toolbarContentInset.bottom),

            closeButton.widthAnchor.constraint(equalToConstant: toolbarButtonSize),
            closeButton.heightAnchor.constraint(equalToConstant: toolbarButtonSize),
            backButton.widthAnchor.constraint(equalToConstant: toolbarButtonSize),
            backButton.heightAnchor.constraint(equalToConstant: toolbarButtonSize),
            forwardButton.widthAnchor.constraint(equalToConstant: toolbarButtonSize),
            forwardButton.heightAnchor.constraint(equalToConstant: toolbarButtonSize),
            collapseButton.widthAnchor.constraint(equalToConstant: toolbarButtonSize),
            collapseButton.heightAnchor.constraint(equalToConstant: toolbarButtonSize)
        ])

        titleMinimumWidthConstraint = titleLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 120)
        titleMinimumWidthConstraint?.isActive = true
        applyToolbarCollapsedState(animated: false)
    }

    private func makeToolbarButton(symbolName: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.tintColor = .label
        button.backgroundColor = UIColor.secondarySystemBackground.withAlphaComponent(0.55)
        button.layer.cornerRadius = toolbarButtonSize / 2
        button.layer.cornerCurve = .continuous
        button.layer.borderWidth = 1 / UIScreen.main.scale
        button.layer.borderColor = UIColor.white.withAlphaComponent(0.12).cgColor
        button.setImage(UIImage(systemName: symbolName), for: .normal)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func updateButtonState(_ button: UIButton, enabled: Bool) {
        button.isEnabled = enabled
        button.alpha = enabled ? 1 : 0.42
    }

    private func applyToolbarCollapsedState(animated: Bool) {
        let updates = {
            self.titleLabel.isHidden = self.isToolbarCollapsed
            self.navButtons.isHidden = self.isToolbarCollapsed
            self.titleMinimumWidthConstraint?.isActive = !self.isToolbarCollapsed

            let symbolName = self.isToolbarCollapsed ? "chevron.up" : "chevron.down"
            self.collapseButton.setImage(UIImage(systemName: symbolName), for: .normal)
            self.view.layoutIfNeeded()
        }

        if animated {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.curveEaseOut, .allowUserInteraction], animations: updates)
        } else {
            updates()
        }
    }

    private func updateDisplayedTitle() {
        let fallbackTitle = popupWebView.url?.host?.replacingOccurrences(of: "www.", with: "") ?? "Loading..."
        let currentTitle = popupWebView.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        titleLabel.text = (currentTitle?.isEmpty == false) ? currentTitle : fallbackTitle
    }

    private func updateWebViewInsets() {
        popupWebView.scrollView.contentInsetAdjustmentBehavior = .never
        popupWebView.scrollView.contentInset = .zero
        popupWebView.scrollView.scrollIndicatorInsets = .zero
    }
}
