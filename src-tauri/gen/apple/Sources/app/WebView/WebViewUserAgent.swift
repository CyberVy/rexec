import UIKit

// to use iPhone style YouTube Iframe Player UI for iPad, which allows fullscreen and PIP in WKWebview env.
func makeIphoneLikeUserAgent() -> String {
    let systemVersion = UIDevice.current.systemVersion
    let osToken = systemVersion.replacingOccurrences(of: ".", with: "_")
    let versionComponents = systemVersion.split(separator: ".")
    let safariVersion = versionComponents.prefix(2).joined(separator: ".")
    let safariVersionToken = safariVersion.isEmpty ? systemVersion : safariVersion

    return "Mozilla/5.0 (iPhone; CPU iPhone OS \(osToken) like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/\(safariVersionToken) Mobile/15E148 Safari/604.1"
}
