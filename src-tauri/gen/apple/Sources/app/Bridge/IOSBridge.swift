import ObjectiveC.runtime
import UIKit
import WebKit

private final class WeakScriptMessageHandlerWithReply: NSObject, WKScriptMessageHandlerWithReply {
    weak var delegate: WKScriptMessageHandlerWithReply?

    init(delegate: WKScriptMessageHandlerWithReply) {
        self.delegate = delegate
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let delegate else {
            replyHandler([
                "ok": false,
                "error": [
                    "code": "DISPOSED",
                    "message": "iOS IPC bridge is no longer active"
                ]
            ], nil)
            return
        }
        delegate.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}

/// Capability signal. JS checks `window.webkit.messageHandlers["iosCap_<name>"] !== undefined`.
/// Message handlers are registered natively before the first navigation and are visible to every frame at
/// document creation, so unlike a user script this has no injection-order dependency.
private final class CapabilityMarkerHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {}
}

final class IOSBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "iosIpcBridge"
    static let capabilityHandlerPrefix = "iosCap_"

    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    private let contentController: WKUserContentController
    private var modules: [any IOSBridgeModule] = []
    private var capabilityHandlerNames = Set<String>()
    private var isInstalled = false

    init(webView: WKWebView, controller: UIViewController?) {
        self.webView = webView
        self.viewController = controller
        self.contentController = webView.configuration.userContentController
        super.init()
    }

    deinit {
        uninstall()
    }

    func register(_ module: any IOSBridgeModule) {
        modules.append(module)
        guard isInstalled else { return }
        module.didInstall(context: makeHostContext())
        publishCapability(of: module)
    }

    func install() {
        guard !isInstalled, let webView else { return }
        isInstalled = true

        contentController.removeScriptMessageHandler(forName: IOSBridge.handlerName, contentWorld: .page)
        contentController.addScriptMessageHandler(
            WeakScriptMessageHandlerWithReply(delegate: self),
            contentWorld: .page,
            name: IOSBridge.handlerName
        )
        diagInstallHandler()

        webView.iosBridge = self

        let hostContext = makeHostContext()
        for module in modules {
            module.didInstall(context: hostContext)
            publishCapability(of: module)
        }
        diagAfterInstall()
    }

    func uninstall() {
        diagLog("uninstall isInstalled=\(isInstalled) modules=\(modules.count)")
        let currentModules = modules
        modules.removeAll()
        for module in currentModules {
            module.didUninstall()
        }

        guard isInstalled else { return }
        isInstalled = false

        contentController.removeScriptMessageHandler(forName: IOSBridge.handlerName, contentWorld: .page)
        for name in capabilityHandlerNames {
            contentController.removeScriptMessageHandler(forName: name, contentWorld: .page)
        }
        capabilityHandlerNames.removeAll()
        diagRemoveHandler()
        if let webView, webView.iosBridge === self {
            webView.iosBridge = nil
        }
    }

    func emit(type: String, payload: [String: Any]? = nil) {
        var envelope: [String: Any] = ["type": type]
        if let payload {
            envelope["payload"] = payload
        }
        guard JSONSerialization.isValidJSONObject(envelope),
              let data = try? JSONSerialization.data(withJSONObject: envelope),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        let js = "window.__IOS_IPC__?.dispatch(\(json))"
        runOnMain { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    func call(
        type: String,
        payload: [String: Any] = [:],
        completion: @escaping (Result<Any?, Error>) -> Void
    ) {
        let args: [String: Any] = [
            "type": type,
            "payload": payload
        ]
        guard JSONSerialization.isValidJSONObject(args) else {
            completion(.failure(makeError("iOS IPC call arguments are not JSON-serializable")))
            return
        }

        let script = """
        if (!window.__IOS_IPC__?.invoke) {
            throw new Error("iOS IPC runtime not ready");
        }
        return await window.__IOS_IPC__.invoke(type, payload);
        """

        runOnMain { [weak self] in
            guard let webView = self?.webView else {
                completion(.failure(makeError("Target WebView is no longer available")))
                return
            }

            webView.callAsyncJavaScript(script, arguments: args, in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    completion(.success(value is Void ? nil : value))
                case .failure(let error):
                    let nsError = error as NSError
                    let message = (nsError.userInfo["WKJavaScriptExceptionMessage"] as? String)
                        ?? nsError.localizedDescription
                    completion(.failure(makeError(message)))
                }
            }
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        let reply = IOSBridgeReply(replyHandler)
        guard message.name == IOSBridge.handlerName else {
            reply.reject(code: "UNSUPPORTED_TYPE", message: "Unknown script message handler: \(message.name)")
            return
        }

        guard let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              !type.isEmpty else {
            reply.reject(code: "INVALID_PAYLOAD", message: "Missing iOS IPC message type")
            return
        }

        let payload = body["payload"] as? [String: Any] ?? [:]
        diagLogMessage(type: type, message: message)

        guard let module = modules.first(where: { $0.isAvailable && $0.canHandle(type: type) }) else {
            reply.reject(code: "UNSUPPORTED_TYPE", message: "No handler registered for type: \(type)")
            return
        }

        if module.framePolicy == .mainFrameOnly && !message.frameInfo.isMainFrame {
            reply.reject(code: "FORBIDDEN", message: "Subframe access denied for type: \(type)")
            return
        }

        if !allowsOrigin(module.originPolicy, frameOrigin: message.frameInfo.securityOrigin) {
            reply.reject(code: "FORBIDDEN", message: "Origin access denied for type: \(type)")
            return
        }

        let context = IOSBridgeMessageContext(
            webView: webView ?? message.webView,
            viewController: viewController,
            bridge: self,
            isMainFrame: message.frameInfo.isMainFrame,
            securityOrigin: message.frameInfo.securityOrigin
        )
        module.handle(type: type, payload: payload, context: context, reply: reply)
    }

    private func makeHostContext() -> IOSBridgeHostContext {
        IOSBridgeHostContext(webView: webView, viewController: viewController, bridge: self)
    }

    private func publishCapability(of module: any IOSBridgeModule) {
        guard module.isAvailable, let capability = module.capability else { return }
        let name = IOSBridge.capabilityHandlerPrefix + capability
        guard capabilityHandlerNames.insert(name).inserted else { return }
        // addScriptMessageHandler raises on duplicate names, so always clear first.
        contentController.removeScriptMessageHandler(forName: name, contentWorld: .page)
        contentController.add(CapabilityMarkerHandler(), contentWorld: .page, name: name)
    }

    private func allowsOrigin(_ policy: IOSBridgeOriginPolicy, frameOrigin: WKSecurityOrigin) -> Bool {
        switch policy {
        case .any:
            return true
        case .matchMainFrameOrigin:
            guard let url = webView?.url,
                  let scheme = url.scheme,
                  let host = url.host else {
                return false
            }
            let expectedPort = url.port ?? 0
            return frameOrigin.protocol.caseInsensitiveCompare(scheme) == .orderedSame
                && frameOrigin.host.caseInsensitiveCompare(host) == .orderedSame
                && frameOrigin.port == expectedPort
        case .custom(let predicate):
            return predicate(frameOrigin)
        }
    }

    private func runOnMain(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.async(execute: work)
        }
    }
}

private func makeError(_ message: String) -> NSError {
    NSError(domain: "IOSBridge", code: -1, userInfo: [NSLocalizedDescriptionKey: message])
}

private var iosBridgeKey: UInt8 = 0

extension WKWebView {
    var iosBridge: IOSBridge? {
        get {
            objc_getAssociatedObject(self, &iosBridgeKey) as? IOSBridge
        }
        set {
            objc_setAssociatedObject(self, &iosBridgeKey, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        }
    }
}

// MARK: - TEMP DIAGNOSTICS [IOS-DIAG] (remove once the injection regression is root-caused)

private final class IOSDiagMessageHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let label = message.webView?.webviewId ?? "nil"
        NSLog("[IOS-DIAG][js] [%@] %@", label, String(describing: message.body))
    }
}

extension IOSBridge {
    fileprivate static let diagHandlerName = "iosDiag"
    fileprivate static let diagStateBody = """
    var mh = window.webkit && window.webkit.messageHandlers;
    var has = function (name) { return !!(mh && mh[name]); };
    var runtime = window.__IOS_IPC__;
    return {
        bridge: has("iosIpcBridge"),
        caps: {
            webview_router: has("iosCap_webview_router"),
            tauri_proxy: has("iosCap_tauri_proxy"),
            view_switcher_toolbar: has("iosCap_view_switcher_toolbar")
        },
        has_runtime: !!runtime,
        runtime_handlers: runtime && runtime.handlers ? Array.from(runtime.handlers.keys()) : null,
        has_tauri_invoke: !!(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke),
        has_dispatch_fn: !!window.__tauri_ipc_dispatch_message_event,
        has_opener: !!window.opener,
        label: window.__TAURI_WEBVIEW_LABEL__ || null,
        opener_label: window.__TAURI_OPENER_LABEL__ || null,
        top: window === window.top,
        href: location.href
    };
    """

    fileprivate func diagLog(_ message: String) {
        NSLog("[IOS-DIAG][native] [%@] %@", webView?.webviewId ?? "nil", message)
    }

    fileprivate func diagLogMessage(type: String, message: WKScriptMessage) {
        if type.hasPrefix("view_switcher_toolbar") { return }
        diagLog("recv type=\(type) mainFrame=\(message.frameInfo.isMainFrame) origin=\(message.frameInfo.securityOrigin.host)")
    }

    fileprivate func diagInstallHandler() {
        contentController.removeScriptMessageHandler(forName: IOSBridge.diagHandlerName, contentWorld: .page)
        contentController.add(IOSDiagMessageHandler(), contentWorld: .page, name: IOSBridge.diagHandlerName)
    }

    fileprivate func diagRemoveHandler() {
        contentController.removeScriptMessageHandler(forName: IOSBridge.diagHandlerName, contentWorld: .page)
    }

    fileprivate func diagAfterInstall() {
        let summary = modules.map { "\($0.capability ?? "-")(avail=\($0.isAvailable))" }.joined(separator: ",")
        diagLog("install done modules=[\(summary)] url=\(webView?.url?.absoluteString ?? "nil")")
        diagDumpUserScripts("install done")
        for delay in [1.0, 4.0, 10.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                guard let self, let webView = self.webView else { return }
                let script = "JSON.stringify((function () { \(IOSBridge.diagStateBody) })())"
                webView.evaluateJavaScript(script) { result, error in
                    self.diagLog("snapshot t+\(delay)s url=\(webView.url?.absoluteString ?? "nil") result=\(String(describing: result)) error=\(String(describing: error))")
                }
            }
        }
    }

    fileprivate func diagDumpUserScripts(_ stage: String) {
        let scripts = contentController.userScripts
        let lines = scripts.enumerated().map { index, script -> String in
            let head = script.source.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: true).first.map(String.init) ?? ""
            let timing = script.injectionTime == .atDocumentStart ? "start" : "end"
            return "  #\(index) at=\(timing) mainOnly=\(script.isForMainFrameOnly) len=\(script.source.count) head=\(head.prefix(60))"
        }
        diagLog("\(stage) userScripts(\(scripts.count)):\n" + lines.joined(separator: "\n"))
    }
}
