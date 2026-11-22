import UIKit
import WebKit
import ObjectiveC.runtime

/// Handles `window.open` / target `_blank` with an in-app WKWebView popup that shares cookies and routes IPC via IOSBridge.
final class ExternalOpenUIDelegate: NSObject, WKUIDelegate {
    private weak var hostController: UIViewController?
    private weak var mainWebView: WKWebView?

    private let popupControllers = NSMapTable<WKWebView, UIViewController>(
        keyOptions: .weakMemory,
        valueOptions: .weakMemory
    )

    // Map of webview ID -> WKWebView for routing messages
    static let activeWebViews = NSMapTable<NSString, WKWebView>(
        keyOptions: .copyIn,
        valueOptions: .weakMemory
    )

    private static let activeDelegates = NSHashTable<ExternalOpenUIDelegate>.weakObjects()

    init(hostController: UIViewController, mainWebView: WKWebView) {
        self.hostController = hostController
        self.mainWebView = mainWebView
        super.init()

        ExternalOpenUIDelegate.activeDelegates.add(self)
        mainWebView.webviewId = "main"
        ExternalOpenUIDelegate.activeWebViews.setObject(mainWebView, forKey: "main" as NSString)

        let labelScript = WKUserScript(
            source: "window.__TAURI_WEBVIEW_LABEL__ = 'main';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        mainWebView.configuration.userContentController.addUserScript(labelScript)
    }

    static func closePopup(label: String) {
        guard label != "main",
              let targetWebView = activeWebViews.object(forKey: label as NSString) else {
            return
        }

        let work = {
            for delegate in activeDelegates.allObjects {
                if delegate.cleanupPopupWebView(targetWebView, animated: true) {
                    return
                }
            }
        }
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }

    /// Intercept requests that would create a new window and present an in-app WKWebView.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard navigationAction.targetFrame == nil,
              let controller = topMostController() else {
            return nil
        }

        // Share the same cookie/process context as the main WKWebView.
        configuration.processPool = webView.configuration.processPool
        configuration.websiteDataStore = webView.configuration.websiteDataStore

        if #available(iOS 14.0, *) {
            let enableAppBound = shouldEnableAppBound(for: navigationAction.request.url)
            configuration.limitsNavigationsToAppBoundDomains = enableAppBound
        }

        let popupContentController = WKUserContentController()
        let popupId = "popup_" + String(UUID().uuidString.prefix(8))
        let parentId = webView.webviewId ?? "main"

        // Clone main's user scripts (Tauri init + Rust's inject.js), then override the label for this popup.
        for script in webView.configuration.userContentController.userScripts {
            popupContentController.addUserScript(script)
        }

        let initScriptSource = """
        window.__TAURI_WEBVIEW_LABEL__ = '\(popupId)';
        window.__TAURI_OPENER_LABEL__ = '\(parentId)';
        """
        let initScript = WKUserScript(source: initScriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        popupContentController.addUserScript(initScript)

        configuration.userContentController = popupContentController

        let popupWebView = WKWebView(frame: .zero, configuration: configuration)
        popupWebView.customUserAgent = webView.customUserAgent
        popupWebView.tintColor = webView.tintColor
        popupWebView.allowsBackForwardNavigationGestures = webView.allowsBackForwardNavigationGestures
        popupWebView.uiDelegate = self

        popupWebView.webviewId = popupId
        ExternalOpenUIDelegate.activeWebViews.setObject(popupWebView, forKey: popupId as NSString)

        let popupController = PopupWebViewController(webView: popupWebView)
        popupWebView.navigationDelegate = popupController
        popupController.modalPresentationStyle = .overFullScreen
        popupController.modalTransitionStyle = .coverVertical

        popupControllers.setObject(popupController, forKey: popupWebView)
        controller.present(popupController, animated: true)
        installFullPageScreenshot(webView: popupWebView)

        let popupBridge = IOSBridge(webView: popupWebView, controller: popupController)
        popupBridge.register(WebViewRouterModule())
        popupBridge.register(TauriProxyModule(mainWebView: mainWebView))
        popupBridge.install()

        return popupWebView
    }

    func webViewDidClose(_ webView: WKWebView) {
        _ = cleanupPopupWebView(webView, animated: true)
    }

    @discardableResult
    private func cleanupPopupWebView(_ webView: WKWebView, animated: Bool) -> Bool {
        guard let controller = popupControllers.object(forKey: webView) else { return false }
        uninstallFullPageScreenshot(webView: webView)
        webView.iosBridge?.uninstall()
        popupControllers.removeObject(forKey: webView)
        if let id = webView.webviewId {
            ExternalOpenUIDelegate.activeWebViews.removeObject(forKey: id as NSString)
        }
        if controller.presentingViewController != nil && !controller.isBeingDismissed {
            controller.dismiss(animated: animated)
        }
        return true
    }

    private func topMostController() -> UIViewController? {
        guard let hostController else { return nil }
        var top = hostController
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }
}

private var uiDelegateKey: UInt8 = 0

/// Attach the delegate and retain it via associated object to avoid deallocation.
func installExternalOpenDelegate(webView: WKWebView, controller: UIViewController) {
    let delegate = ExternalOpenUIDelegate(hostController: controller, mainWebView: webView)
    webView.uiDelegate = delegate
    objc_setAssociatedObject(webView, &uiDelegateKey, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
}

private var webviewIdKey: UInt8 = 0
extension WKWebView {
    var webviewId: String? {
        get {
            return objc_getAssociatedObject(self, &webviewIdKey) as? String
        }
        set {
            objc_setAssociatedObject(self, &webviewIdKey, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        }
    }
}
