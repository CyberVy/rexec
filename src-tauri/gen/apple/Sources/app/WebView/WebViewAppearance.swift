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
