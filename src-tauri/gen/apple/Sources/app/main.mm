#include "bindings/bindings.h"
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// Keep the original WKWebView initializer so our swizzled implementation can
// delegate back after applying App-Bound Domains configuration.
static id (*originalInitWithFrameConfiguration)(id, SEL, CGRect, WKWebViewConfiguration *);
static BOOL didConfigureMainWebView = NO;

// WKAppBoundDomains is a prerequisite for Service Worker support on iOS when limitsNavigationsToAppBoundDomains is enabled.
// Enable App-Bound mode when the whitelist exists in Info.plist.
static id swizzledInitWithFrameConfiguration(id self, SEL _cmd, CGRect frame, WKWebViewConfiguration *configuration) {
    if (@available(iOS 14.0, *)) {
        NSArray *appBoundDomains = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"WKAppBoundDomains"];
        // This avoids unexpectedly restricting navigation when WKAppBoundDomains is missing.
        if (configuration != nil && [appBoundDomains isKindOfClass:[NSArray class]] && appBoundDomains.count > 0 && !didConfigureMainWebView) {
            // Configure only the first (main) webview here.
            // Additional webviews are handled by popup flow logic.
            configuration.limitsNavigationsToAppBoundDomains = YES;
            didConfigureMainWebView = YES;
        }
    }

    return originalInitWithFrameConfiguration(self, _cmd, frame, configuration);
}

static void enableAppBoundDomainsForAllWebViews(void) {
    // Hook WKWebView initWithFrame:configuration: so the flag is set before
    // each web view starts its first navigation.
    Method method = class_getInstanceMethod([WKWebView class], @selector(initWithFrame:configuration:));
    if (method == nil) return;

    originalInitWithFrameConfiguration =
        (id (*)(id, SEL, CGRect, WKWebViewConfiguration *))method_getImplementation(method);
    method_setImplementation(method, (IMP)swizzledInitWithFrameConfiguration);
}

int main(int argc, char * argv[]) {
    // Install the hook before bootstrapping Tauri.
    enableAppBoundDomainsForAllWebViews();
    ffi::start_app();
    return 0;
}
