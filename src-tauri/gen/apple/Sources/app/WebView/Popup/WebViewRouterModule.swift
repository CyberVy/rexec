import Foundation
import WebKit

final class WebViewRouterModule: IOSBridgeModule {
    let capability: String? = "webview_router"

    func canHandle(type: String) -> Bool {
        type == "webview_router.post_message" || type == "webview_router.close"
    }

    func handle(
        type: String,
        payload: [String: Any],
        context: IOSBridgeMessageContext,
        reply: IOSBridgeReply
    ) {
        switch type {
        case "webview_router.post_message":
            guard let targetLabel = payload["target_label"] as? String, !targetLabel.isEmpty else {
                reply.reject(code: "INVALID_PAYLOAD", message: "Missing target_label for webview_router.post_message")
                return
            }
            guard let messagePayload = payload["message"] else {
                reply.reject(code: "INVALID_PAYLOAD", message: "Missing message for webview_router.post_message")
                return
            }

            let senderLabel = context.webView?.webviewId ?? "unknown"
            if let targetWebView = ExternalOpenUIDelegate.activeWebViews.object(forKey: targetLabel as NSString) {
                targetWebView.iosBridge?.emit(
                    type: "webview_router.message",
                    payload: [
                        "sender_label": senderLabel,
                        "message": messagePayload
                    ]
                )
            }
            reply.resolve(nil)

        case "webview_router.close":
            guard let label = payload["label"] as? String, !label.isEmpty else {
                reply.reject(code: "INVALID_PAYLOAD", message: "Missing label for webview_router.close")
                return
            }
            ExternalOpenUIDelegate.closePopup(label: label)
            reply.resolve(nil)

        default:
            reply.reject(code: "UNSUPPORTED_TYPE", message: "Unsupported webview_router type: \(type)")
        }
    }
}
