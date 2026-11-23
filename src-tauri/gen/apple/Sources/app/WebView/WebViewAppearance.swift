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

// Background:
// tao-0.37.2's TaoUIViewController overrides prefersStatusBarHidden with a stored ivar
// (default NO), which disables UIKit's automatic iPhone landscape status bar hiding.
//
// Forward-compatibility:
// Only restore UIViewController's default getter when running on TaoUIViewController with an
// overridden implementation, so future tao upgrades become a safe no-op.
func installStatusBarAutoHide(controller: UIViewController) {
    guard UIDevice.current.userInterfaceIdiom == .phone else { return }
    let controllerClass: AnyClass = type(of: controller)
    guard NSStringFromClass(controllerClass) == "TaoUIViewController" else { return }
    let sel = #selector(getter: UIViewController.prefersStatusBarHidden)
    guard let baseMethod = class_getInstanceMethod(UIViewController.self, sel),
          let currentMethod = class_getInstanceMethod(controllerClass, sel) else { return }
    let baseImp = method_getImplementation(baseMethod)
    guard method_getImplementation(currentMethod) != baseImp else { return }
    _ = class_replaceMethod(controllerClass, sel, baseImp, method_getTypeEncoding(baseMethod))
    controller.setNeedsStatusBarAppearanceUpdate()
}
