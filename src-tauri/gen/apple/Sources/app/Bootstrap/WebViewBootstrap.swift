import UIKit
import WebKit

@_cdecl("on_webview_created")
public func on_webview_created(_ webviewPtr: UnsafeRawPointer?, _ controllerPtr: UnsafeRawPointer?) {
    guard let webviewPtr, let controllerPtr else { return }

    let webview = Unmanaged<WKWebView>.fromOpaque(webviewPtr).takeUnretainedValue()
    let controller = Unmanaged<UIViewController>.fromOpaque(controllerPtr).takeUnretainedValue()

    webview.tintColor = UIColor.label.withAlphaComponent(0.8)

    // Enable edge-swipe back/forward like Safari.
    webview.allowsBackForwardNavigationGestures = true

    // Restore Safari-style rubber-band bounce on scroll.
    let scrollView = webview.scrollView
    scrollView.bounces = true
    scrollView.alwaysBounceVertical = true
    scrollView.alwaysBounceHorizontal = false

    // Handle window.open/_blank without replacing the current page.
    installExternalOpenDelegate(webView: webview, controller: controller)

    applyNoFlickerStyle(to: webview, in: controller)

    installFullPageScreenshot(webView: webview, controller: controller)
}
