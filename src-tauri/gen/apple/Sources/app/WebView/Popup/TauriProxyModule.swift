import Foundation
import WebKit

final class TauriProxyModule: IOSBridgeModule {
    let capability: String? = "tauri_proxy"
    private weak var mainWebView: WKWebView?

    init(mainWebView: WKWebView?) {
        self.mainWebView = mainWebView
    }

    func canHandle(type: String) -> Bool {
        type == "tauri_proxy.invoke"
    }

    func handle(
        type: String,
        payload: [String: Any],
        context: IOSBridgeMessageContext,
        reply: IOSBridgeReply
    ) {
        guard let cmd = payload["cmd"] as? String, !cmd.isEmpty else {
            reply.reject(code: "INVALID_PAYLOAD", message: "Missing cmd for tauri_proxy.invoke")
            return
        }
        if cmd == "set_runtime_inject_script" {
            reply.reject(code: "FORBIDDEN", message: "Command \(cmd) is not allowed from popup webviews")
            return
        }
        guard let mainBridge = mainWebView?.iosBridge else {
            reply.reject(code: "UNAVAILABLE", message: "Main WebView bridge is not available")
            return
        }

        let args = payload["args"] as? [String: Any] ?? [:]
        mainBridge.call(
            type: "tauri_proxy.execute",
            payload: [
                "cmd": cmd,
                "args": args
            ]
        ) { result in
            switch result {
            case .success(let value):
                reply.resolve(value)
            case .failure(let error):
                reply.reject(code: "NATIVE_ERROR", message: error.localizedDescription)
            }
        }
    }
}
