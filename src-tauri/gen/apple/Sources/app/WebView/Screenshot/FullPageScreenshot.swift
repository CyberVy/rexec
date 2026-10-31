import UIKit
import WebKit

@available(iOS 14.0, *)
private class ScreenshotManager: NSObject, UIScreenshotServiceDelegate {

    static let shared = ScreenshotManager()

    private struct WeakWebView {

        weak var value: WKWebView?
    }

    private var webViews: [WeakWebView] = []

    override init() {
        super.init()

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(rebindDelegate),
            name: UIScene.didActivateNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func install(
        _ webView: WKWebView,
        controller: UIViewController? = nil
    ) {

        cleanup()

        if !webViews.contains(where: { $0.value === webView }) {
            webViews.append(.init(value: webView))
        }

        bindDelegate(
            scene:
                controller?.view.window?.windowScene
                ?? webView.window?.windowScene
        )
    }

    func uninstall(_ webView: WKWebView) {

        webViews.removeAll {
            $0.value == nil || $0.value === webView
        }
    }

    @objc
    private func rebindDelegate() {

        bindDelegate(
            scene: activeWebView()?.window?.windowScene
        )
    }

    private func bindDelegate(
        scene: UIWindowScene?
    ) {

        scene?
            .screenshotService?
            .delegate = self
    }

    private func activeWebView() -> WKWebView? {

        cleanup()

        return webViews.last {
            guard let webView = $0.value else {
                return false
            }

            return
                !webView.isHidden &&
                webView.window != nil
        }?.value
    }

    private func cleanup() {

        webViews.removeAll {
            $0.value == nil
        }
    }

    func screenshotService(
        _ screenshotService: UIScreenshotService,
        generatePDFRepresentationWithCompletion completionHandler: @escaping (
            Data?,
            Int,
            CGRect
        ) -> Void
    ) {

        guard let webView = activeWebView() else {

            completionHandler(
                nil,
                0,
                .zero
            )

            return
        }

        let rect = CGRect(
            origin: .zero,
            size: webView.scrollView.contentSize
        )

        guard
            rect.width > 0,
            rect.height > 0
        else {

            completionHandler(
                nil,
                0,
                .zero
            )

            return
        }

        let configuration = WKPDFConfiguration()
        configuration.rect = rect

        webView.createPDF(
            configuration: configuration
        ) { result in

            switch result {

            case .success(let data):

                completionHandler(
                    data,
                    0,
                    rect
                )

            case .failure:

                completionHandler(
                    nil,
                    0,
                    .zero
                )
            }
        }
    }
}

@available(iOS 14.0, *)
func installFullPageScreenshot(
    webView: WKWebView,
    controller: UIViewController
) {

    ScreenshotManager.shared.install(
        webView,
        controller: controller
    )
}

@available(iOS 14.0, *)
func installFullPageScreenshot(
    webView: WKWebView
) {

    ScreenshotManager.shared.install(webView)
}

@available(iOS 14.0, *)
func uninstallFullPageScreenshot(
    webView: WKWebView
) {

    ScreenshotManager.shared.uninstall(webView)
}
