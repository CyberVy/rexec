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

final class IOSBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let handlerName = "iosIpcBridge"
    static let hostScriptPrefix = "// @rexec-ios-"
    private static let bridgeScriptMarker = "// @rexec-ios-bridge-script"

    private weak var webView: WKWebView?
    private weak var viewController: UIViewController?
    private weak var userContentController: WKUserContentController?
    private var modules: [any IOSBridgeModule] = []
    private var isInstalled = false

    init(webView: WKWebView, controller: UIViewController?) {
        self.webView = webView
        self.viewController = controller
        self.userContentController = webView.configuration.userContentController
        super.init()
    }

    deinit {
        uninstall()
    }

    static func isHostManagedScript(_ script: WKUserScript) -> Bool {
        script.source.hasPrefix(hostScriptPrefix)
    }

    static func prependHostScript(_ script: WKUserScript, to contentController: WKUserContentController) {
        let existing = contentController.userScripts
        contentController.removeAllUserScripts()
        contentController.addUserScript(script)
        for item in existing {
            contentController.addUserScript(item)
        }
    }

    func register(_ module: any IOSBridgeModule) {
        modules.append(module)
        if isInstalled {
            module.didInstall(context: makeHostContext())
            syncCapabilityScript()
        }
    }

    func install() {
        guard !isInstalled, let webView else { return }
        isInstalled = true

        let contentController = webView.configuration.userContentController
        userContentController = contentController
        contentController.removeScriptMessageHandler(forName: IOSBridge.handlerName, contentWorld: .page)
        contentController.addScriptMessageHandler(
            WeakScriptMessageHandlerWithReply(delegate: self),
            contentWorld: .page,
            name: IOSBridge.handlerName
        )

        webView.iosBridge = self

        let hostContext = makeHostContext()
        for module in modules {
            module.didInstall(context: hostContext)
        }
        syncCapabilityScript()
    }

    func uninstall() {
        let currentModules = modules
        modules.removeAll()
        for module in currentModules {
            module.didUninstall()
        }

        guard isInstalled else { return }
        isInstalled = false

        userContentController?.removeScriptMessageHandler(forName: IOSBridge.handlerName, contentWorld: .page)
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

        let js = "window.__REXEC_IOS_IPC__?.dispatch(\(json))"
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
        if (!window.__REXEC_IOS_IPC__?.invoke) {
            throw new Error("iOS IPC runtime not ready");
        }
        return await window.__REXEC_IOS_IPC__.invoke(type, payload);
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

    private func syncCapabilityScript() {
        guard let contentController = webView?.configuration.userContentController else { return }

        var seen = Set<String>()
        var capabilities: [String] = []
        for module in modules where module.isAvailable {
            if let capability = module.capability, seen.insert(capability).inserted {
                capabilities.append(capability)
            }
        }

        guard let data = try? JSONSerialization.data(withJSONObject: capabilities),
              let capsJson = String(data: data, encoding: .utf8) else {
            return
        }

        let source = """
        \(IOSBridge.bridgeScriptMarker)
        window.__REXEC_IOS_IPC_CAPS__ = \(capsJson);
        window.__REXEC_IOS_IPC__?.sync_capabilities?.();
        """

        let script = WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        let preserved = contentController.userScripts.filter { !$0.source.hasPrefix(IOSBridge.bridgeScriptMarker) }
        contentController.removeAllUserScripts()
        contentController.addUserScript(script)
        for existing in preserved {
            contentController.addUserScript(existing)
        }

        runOnMain { [weak self] in
            self?.webView?.evaluateJavaScript(source, completionHandler: nil)
        }
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
