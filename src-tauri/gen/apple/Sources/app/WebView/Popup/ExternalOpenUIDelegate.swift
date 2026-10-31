import UIKit
import WebKit
import ObjectiveC.runtime

class LeakAvoider: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(delegate: WKScriptMessageHandler) {
        self.delegate = delegate
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

/// Handles `window.open` / target `_blank` with an in-app WKWebView popup that shares cookies and routes Tauri IPC.
final class ExternalOpenUIDelegate: NSObject, WKUIDelegate {
    private weak var hostController: UIViewController?
    private weak var mainWebView: WKWebView?
    
    // Map of request ID -> popup WebView (for invoke replies)
    private let pendingRequests = NSMapTable<NSString, WKWebView>(
        keyOptions: .copyIn,
        valueOptions: .weakMemory
    )
    
    private let popupControllers = NSMapTable<WKWebView, UIViewController>(
        keyOptions: .weakMemory,
        valueOptions: .weakMemory
    )

    // Map of webview ID -> WKWebView for routing messages
    static let activeWebViews = NSMapTable<NSString, WKWebView>(
        keyOptions: .copyIn,
        valueOptions: .weakMemory
    )

    init(hostController: UIViewController, mainWebView: WKWebView) {
        self.hostController = hostController
        self.mainWebView = mainWebView
        super.init()
        
        mainWebView.webviewId = "main"
        ExternalOpenUIDelegate.activeWebViews.setObject(mainWebView, forKey: "main" as NSString)
        
        // Inject label for main Webview
        let source = "window.__TAURI_WEBVIEW_LABEL__ = 'main';"
        let script = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        mainWebView.configuration.userContentController.addUserScript(script)
        
        // Add message handlers to main WebView for response routing
        let avoider = LeakAvoider(delegate: self)
        mainWebView.configuration.userContentController.add(avoider, name: "tauriPopupBridge")
        mainWebView.configuration.userContentController.add(avoider, name: "tauriPopupInvokeReply")
    }
    
    deinit {
        mainWebView?.configuration.userContentController.removeScriptMessageHandler(forName: "tauriPopupBridge")
        mainWebView?.configuration.userContentController.removeScriptMessageHandler(forName: "tauriPopupInvokeReply")
    }

    /// Intercept requests that would create a new window and present an in-app WKWebView.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
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
        
        // 1. Create a clean user content controller
        let popupContentController = WKUserContentController()
        
        // 2. Clone all user scripts from the main WebView so they are uniformly injected
        for script in webView.configuration.userContentController.userScripts {
            popupContentController.addUserScript(script)
        }
        
        let popupId = "popup_" + String(UUID().uuidString.prefix(8))
        let parentId = webView.webviewId ?? "main"
        
        // Inject label and opener label
        let initScriptSource = "window.__TAURI_WEBVIEW_LABEL__ = '\(popupId)'; window.__TAURI_OPENER_LABEL__ = '\(parentId)';"
        let initScript = WKUserScript(source: initScriptSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        popupContentController.addUserScript(initScript)
        
        // 4. Add popup-specific message handlers for request routing
        let avoider = LeakAvoider(delegate: self)
        popupContentController.add(avoider, name: "tauriPopupBridge")
        popupContentController.add(avoider, name: "tauriPopupInvoke")
        
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
        return popupWebView
    }

    func webViewDidClose(_ webView: WKWebView) {
        uninstallFullPageScreenshot(webView: webView)
        guard let controller = popupControllers.object(forKey: webView) else { return }
        controller.dismiss(animated: true)
        popupControllers.removeObject(forKey: webView)
        if let id = webView.webviewId {
            ExternalOpenUIDelegate.activeWebViews.removeObject(forKey: id as NSString)
        }
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

extension ExternalOpenUIDelegate: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "tauriPopupBridge",
           let body = message.body as? [String: Any],
           let targetLabel = body["target_label"] as? String,
           let msgPayload = body["message"] {
            
            let senderWebView = message.webView
            let senderLabel = senderWebView?.webviewId ?? "unknown"
            
            if let targetWebView = ExternalOpenUIDelegate.activeWebViews.object(forKey: targetLabel as NSString) {
                if let payloadData = try? JSONSerialization.data(withJSONObject: msgPayload, options: []),
                   let payloadString = String(data: payloadData, encoding: .utf8) {
                    
                    let js = "if (window.__tauri_ipc_dispatch_message_event) { window.__tauri_ipc_dispatch_message_event(\(payloadString), '\(senderLabel)'); } else { window.postMessage(\(payloadString), '*'); }"
                    targetWebView.evaluateJavaScript(js, completionHandler: nil)
                }
            }
        }
        else if message.name == "tauriPopupInvoke",
                let popupWebView = message.webView,
                let body = message.body as? [String: Any],
                let id = body["id"] as? String,
                let cmd = body["cmd"] as? String,
                let args = body["args"] as? [String: Any] {
            
            pendingRequests.setObject(popupWebView, forKey: id as NSString)
            
            if let mainWebView = mainWebView,
               let argsJsonData = try? JSONSerialization.data(withJSONObject: args, options: []),
               let argsJsonString = String(data: argsJsonData, encoding: .utf8),
               let cmdJsonData = try? JSONSerialization.data(withJSONObject: cmd, options: .fragmentsAllowed),
               let cmdJsonString = String(data: cmdJsonData, encoding: .utf8),
               let idJsonData = try? JSONSerialization.data(withJSONObject: id, options: .fragmentsAllowed),
               let idJsonString = String(data: idJsonData, encoding: .utf8) {
                
                let js = "window.__tauri_ios_main_proxy_popup_invoke(\(idJsonString), \(cmdJsonString), \(argsJsonString))"
                mainWebView.evaluateJavaScript(js, completionHandler: nil)
            }
        }
        else if message.name == "tauriPopupInvokeReply",
                let body = message.body as? [String: Any],
                let id = body["id"] as? String,
                let status = body["status"] as? String {
            
            if let popupWebView = pendingRequests.object(forKey: id as NSString) {
                pendingRequests.removeObject(forKey: id as NSString)
                
                let data = body["data"] ?? NSNull()
                if let dataJsonData = try? JSONSerialization.data(withJSONObject: [data], options: []),
                   let dataJsonString = String(data: dataJsonData, encoding: .utf8),
                   let idJsonData = try? JSONSerialization.data(withJSONObject: id, options: .fragmentsAllowed),
                   let idJsonString = String(data: idJsonData, encoding: .utf8),
                   let statusJsonData = try? JSONSerialization.data(withJSONObject: status, options: .fragmentsAllowed),
                   let statusJsonString = String(data: statusJsonData, encoding: .utf8) {
                    
                    let js = "if (window.__tauri_ios_popup_resolve_pending_invoke) { window.__tauri_ios_popup_resolve_pending_invoke(\(idJsonString), \(statusJsonString), \(dataJsonString)[0]); }"
                    popupWebView.evaluateJavaScript(js, completionHandler: nil)
                }
            }
        }
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

