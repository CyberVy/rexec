import UIKit
import WebKit

// Applies background and opacity tweaks to reduce flicker when embedding WKWebView.
func applyNoFlickerStyle(to webview: WKWebView, in controller: UIViewController) {
    let bg = UIColor.systemBackground

    controller.view.backgroundColor = bg
    webview.isOpaque = false
    webview.backgroundColor = bg
    webview.scrollView.backgroundColor = bg
}

// tao's TaoUIViewController overrides prefersStatusBarHidden with a stored value (default NO),
// which disables UIKit's iPhone landscape auto-hide. Point it back at UIViewController's own
// implementation, using only public selectors.
func installStatusBarAutoHide(controller: UIViewController) {
    guard UIDevice.current.userInterfaceIdiom == .phone else { return }
    let sel = #selector(getter: UIViewController.prefersStatusBarHidden)
    guard let original = class_getInstanceMethod(UIViewController.self, sel) else { return }
    _ = class_replaceMethod(
        type(of: controller), sel, method_getImplementation(original), method_getTypeEncoding(original)
    )
    controller.setNeedsStatusBarAppearanceUpdate()
}
