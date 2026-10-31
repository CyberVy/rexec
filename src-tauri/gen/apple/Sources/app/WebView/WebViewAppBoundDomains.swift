import Foundation
import WebKit

private let appBoundDomainSet: Set<String> = {
    let raw = Bundle.main.object(forInfoDictionaryKey: "WKAppBoundDomains") as? [String] ?? []
    return Set(raw.map { $0.lowercased() })
}()

func shouldEnableAppBound(for url: URL?) -> Bool {
    guard let host = url?.host?.lowercased() else { return false }
    return appBoundDomainSet.contains(host)
}

// static const WKNavigationActionPolicy WK_API_AVAILABLE(macos(10.11), ios(9.0)) _WKNavigationActionPolicyAllowWithoutTryingAppLink = (WKNavigationActionPolicy)(WKNavigationActionPolicyAllow + 2);
// according to https://github.com/WebKit/WebKit/blob/995f6b1595611c934e742a4f3a9af2e678bc6b8d/Source/WebKit/UIProcess/API/Cocoa/WKNavigationDelegatePrivate.h#L61
func allowWithoutTryingAppLinkPolicy() -> WKNavigationActionPolicy {
    if let policy = WKNavigationActionPolicy(rawValue: WKNavigationActionPolicy.allow.rawValue + 2) {
        return policy
    }
    return .allow
}
