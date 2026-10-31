#[cfg(all(target_os = "macos", feature = "macos-disable-itp"))]
use objc2::{
    msg_send,
    rc::Retained,
    runtime::{AnyClass, AnyObject},
};

#[allow(dead_code)]
pub fn disable() {
    #[cfg(all(target_os = "macos", feature = "macos-disable-itp"))]
    unsafe {
        let cls = AnyClass::get(c"WKWebsiteDataStore").expect("WKWebsiteDataStore not found");
        let store: Retained<AnyObject> = msg_send![cls, defaultDataStore];
        let _: () = msg_send![&store, _setResourceLoadStatisticsEnabled: false];
    }
}
