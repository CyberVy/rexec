import UIKit
import WebKit

enum IOSBridgeFramePolicy {
    case mainFrameOnly
    case anyFrame
}

enum IOSBridgeOriginPolicy {
    case any
    case matchMainFrameOrigin
    case custom((WKSecurityOrigin) -> Bool)
}

struct IOSBridgeHostContext {
    weak var webView: WKWebView?
    weak var viewController: UIViewController?
    weak var bridge: IOSBridge?
}

struct IOSBridgeMessageContext {
    weak var webView: WKWebView?
    weak var viewController: UIViewController?
    weak var bridge: IOSBridge?
    let isMainFrame: Bool
    let securityOrigin: WKSecurityOrigin
}

final class IOSBridgeReply {
    private let lock = NSLock()
    private var isSettled = false
    private let replyHandler: (Any?, String?) -> Void

    init(_ replyHandler: @escaping (Any?, String?) -> Void) {
        self.replyHandler = replyHandler
    }

    deinit {
        reject(code: "DISPOSED", message: "Native IPC handler released before replying")
    }

    func resolve(_ value: Any? = nil) {
        var envelope: [String: Any] = ["ok": true]
        if let unwrapped = unwrapOptionalValue(value) {
            envelope["data"] = unwrapped
        }
        send(envelope)
    }

    func reject(code: String = "NATIVE_ERROR", message: String, details: Any? = nil) {
        var errorPayload: [String: Any] = [
            "code": code,
            "message": message
        ]
        if let details {
            errorPayload["details"] = details
        }
        send([
            "ok": false,
            "error": errorPayload
        ])
    }

    private func send(_ payload: [String: Any]) {
        lock.lock()
        guard !isSettled else {
            lock.unlock()
            return
        }
        isSettled = true
        lock.unlock()

        let sanitizedPayload: [String: Any]
        if JSONSerialization.isValidJSONObject(payload) {
            sanitizedPayload = payload
        } else {
            sanitizedPayload = [
                "ok": false,
                "error": [
                    "code": "INVALID_PAYLOAD",
                    "message": "Native IPC reply is not JSON-serializable"
                ]
            ]
        }

        if Thread.isMainThread {
            replyHandler(sanitizedPayload, nil)
        } else {
            DispatchQueue.main.async { [replyHandler] in
                replyHandler(sanitizedPayload, nil)
            }
        }
    }
}

private func unwrapOptionalValue(_ value: Any?) -> Any? {
    guard let value else { return nil }
    if value is Void { return nil }
    let mirror = Mirror(reflecting: value)
    if mirror.displayStyle == .optional {
        guard let child = mirror.children.first?.value else { return nil }
        return unwrapOptionalValue(child)
    }
    return value
}

protocol IOSBridgeModule: AnyObject {
    var capability: String? { get }
    var isAvailable: Bool { get }
    var framePolicy: IOSBridgeFramePolicy { get }
    var originPolicy: IOSBridgeOriginPolicy { get }

    func canHandle(type: String) -> Bool
    func didInstall(context: IOSBridgeHostContext)
    func didUninstall()
    func handle(type: String, payload: [String: Any], context: IOSBridgeMessageContext, reply: IOSBridgeReply)
}

extension IOSBridgeModule {
    var isAvailable: Bool { true }
    var framePolicy: IOSBridgeFramePolicy { .mainFrameOnly }
    var originPolicy: IOSBridgeOriginPolicy { .any }

    func didInstall(context: IOSBridgeHostContext) {}
    func didUninstall() {}
}
