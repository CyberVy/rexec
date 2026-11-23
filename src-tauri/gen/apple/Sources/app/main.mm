#include "bindings/bindings.h"
#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// Background:
// 1. Info.plist declares UIApplicationSceneManifest so tao defers window creation from
//    application:didFinishLaunchingWithOptions: into TaoSceneDelegate.scene:willConnectToSession:.
// 2. tao-0.37.2 still creates TaoUIWindow via legacy initWithFrame: and attaches windowScene
//    afterward, leaving UIKit's safeAreaInsets locked to portrait values until a fullscreen/PiP
//    transition forces recalculation.
//
// Forward-compatibility:
// We also track UIWindow.initWithWindowScene: reentrancy depth so if a future tao release
// calls initWithWindowScene: natively, UIKit's internal initWithFrame: call passes straight
// through without double-initializing the window.
static id (*originalWindowInitWithFrame)(id, SEL, CGRect);
static id (*originalWindowInitWithWindowScene)(id, SEL, UIWindowScene *);
static void (*originalSetDelegateClass)(id, SEL, Class);
static void (*originalSceneWillConnect)(id, SEL, UIScene *, UISceneSession *, UISceneConnectionOptions *);
static UIWindowScene *gConnectingWindowScene = nil;
static NSInteger gWindowSceneInitDepth = 0;

static void swizzledSceneWillConnect(
    id self,
    SEL _cmd,
    UIScene *scene,
    UISceneSession *session,
    UISceneConnectionOptions *options
) {
    UIWindowScene *previous = gConnectingWindowScene;
    if ([scene isKindOfClass:[UIWindowScene class]]) {
        gConnectingWindowScene = (UIWindowScene *)scene;
    }
    originalSceneWillConnect(self, _cmd, scene, session, options);
    gConnectingWindowScene = previous;
}

static void swizzledSetDelegateClass(id self, SEL _cmd, Class delegateClass) {
    static BOOL didHookSceneDelegate = NO;
    if (!didHookSceneDelegate && delegateClass != nil &&
        [NSStringFromClass(delegateClass) isEqualToString:@"TaoSceneDelegate"]) {
        SEL sel = @selector(scene:willConnectToSession:options:);
        Method method = class_getInstanceMethod(delegateClass, sel);
        if (method != nil) {
            originalSceneWillConnect =
                (void (*)(id, SEL, UIScene *, UISceneSession *, UISceneConnectionOptions *))
                    method_getImplementation(method);
            method_setImplementation(method, (IMP)swizzledSceneWillConnect);
            didHookSceneDelegate = YES;
        }
    }
    originalSetDelegateClass(self, _cmd, delegateClass);
}

static UIWindowScene *findTargetWindowScene(void) {
    if (gConnectingWindowScene != nil && gConnectingWindowScene.windows.count == 0) {
        return gConnectingWindowScene;
    }
    UIApplication *app = [UIApplication sharedApplication];
    UIWindowScene *firstScene = nil;
    for (UIScene *scene in app.connectedScenes) {
        if ([scene isKindOfClass:[UIWindowScene class]]) {
            UIWindowScene *ws = (UIWindowScene *)scene;
            if (!firstScene) {
                firstScene = ws;
            }
            if (ws.windows.count == 0) {
                return ws;
            }
        }
    }
    return gConnectingWindowScene ?: (app.supportsMultipleScenes ? nil : firstScene);
}

static id swizzledWindowInitWithWindowScene(id self, SEL _cmd, UIWindowScene *windowScene) {
    gWindowSceneInitDepth++;
    id win = originalWindowInitWithWindowScene(self, _cmd, windowScene);
    gWindowSceneInitDepth--;
    return win;
}

static id swizzledWindowInitWithFrame(id self, SEL _cmd, CGRect frame) {
    if (gWindowSceneInitDepth == 0 && [NSStringFromClass([self class]) isEqualToString:@"TaoUIWindow"]) {
        UIWindowScene *ws = findTargetWindowScene();
        if (ws != nil) {
            return [(UIWindow *)self initWithWindowScene:ws];
        }
    }
    return originalWindowInitWithFrame(self, _cmd, frame);
}

static void enableWindowSceneInitForTaoWindow(void) {
    Method configMethod = class_getInstanceMethod([UISceneConfiguration class], @selector(setDelegateClass:));
    if (configMethod != nil) {
        originalSetDelegateClass = (void (*)(id, SEL, Class))method_getImplementation(configMethod);
        method_setImplementation(configMethod, (IMP)swizzledSetDelegateClass);
    }

    Method sceneInitMethod = class_getInstanceMethod([UIWindow class], @selector(initWithWindowScene:));
    if (sceneInitMethod != nil) {
        originalWindowInitWithWindowScene =
            (id (*)(id, SEL, UIWindowScene *))method_getImplementation(sceneInitMethod);
        method_setImplementation(sceneInitMethod, (IMP)swizzledWindowInitWithWindowScene);
    }

    Method frameInitMethod = class_getInstanceMethod([UIWindow class], @selector(initWithFrame:));
    if (frameInitMethod != nil) {
        originalWindowInitWithFrame =
            (id (*)(id, SEL, CGRect))method_getImplementation(frameInitMethod);
        method_setImplementation(frameInitMethod, (IMP)swizzledWindowInitWithFrame);
    }
}

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
    enableWindowSceneInitForTaoWindow();
    enableAppBoundDomainsForAllWebViews();
    ffi::start_app();
    return 0;
}
