use std::sync::Mutex;
use tauri::{Runtime, Webview};

const RUNTIME_INJECT_MARKER: &str = "// __TAURI_RUNTIME_INJECT__\n";

#[derive(Default)]
pub struct RuntimeInjectState {
    script: Mutex<Option<String>>,
    #[cfg(target_os = "windows")]
    windows_script_id: Mutex<Option<String>>,
}

impl RuntimeInjectState {
    pub fn current_script(&self) -> Option<String> {
        self.script.lock().unwrap().clone()
    }

    pub fn set_script(&self, script: Option<String>) {
        *self.script.lock().unwrap() = script;
    }

    #[cfg(target_os = "windows")]
    fn replace_windows_script_id(&self, next: Option<String>) -> Option<String> {
        std::mem::replace(&mut *self.windows_script_id.lock().unwrap(), next)
    }
}

pub fn format_marked_script(raw_script: &str) -> Option<String> {
    let trimmed = raw_script.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(format!("{RUNTIME_INJECT_MARKER}{trimmed}"))
    }
}

pub async fn apply_runtime_inject_script<R: Runtime>(
    webview: &Webview<R>,
    state: &RuntimeInjectState,
    raw_script: &str,
) -> Result<(), String> {
    let marked_script = format_marked_script(raw_script);
    state.set_script(marked_script.clone());

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        apply_apple_runtime_script(webview, marked_script).await
    }

    #[cfg(target_os = "windows")]
    {
        apply_windows_runtime_script(webview, state, marked_script).await
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    {
        apply_linux_runtime_script(webview, marked_script).await
    }

    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "windows",
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    )))]
    {
        let _ = (webview, marked_script);
        Ok(())
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
async fn apply_apple_runtime_script<R: Runtime>(
    webview: &Webview<R>,
    marked_script: Option<String>,
) -> Result<(), String> {
    use objc2::{rc::Retained, MainThreadMarker, MainThreadOnly};
    use objc2_foundation::NSString;
    use objc2_web_kit::{WKUserContentController, WKUserScript, WKUserScriptInjectionTime};

    let (tx, mut rx) = tauri::async_runtime::channel::<Result<(), String>>(1);

    webview
        .with_webview(move |platform_webview| {
            let result = (|| -> Result<(), String> {
                let controller_ptr = platform_webview.controller().cast::<WKUserContentController>();
                if controller_ptr.is_null() {
                    return Err("WKUserContentController is unavailable".to_string());
                }

                // SAFETY: `with_webview` executes on the Apple main thread and `controller()`
                // returns a valid `WKUserContentController` pointer owned by the WebView.
                unsafe {
                    let controller = &*controller_ptr;
                    let existing_scripts = controller.userScripts();
                    let mut kept_scripts: Vec<Retained<WKUserScript>> =
                        Vec::with_capacity(existing_scripts.len());

                    for script in existing_scripts.iter() {
                        if !script.source().to_string().starts_with(RUNTIME_INJECT_MARKER) {
                            kept_scripts.push(script);
                        }
                    }

                    controller.removeAllUserScripts();
                    for script in &kept_scripts {
                        controller.addUserScript(script);
                    }

                    if let Some(script_source) = marked_script {
                        let mtm = MainThreadMarker::new_unchecked();
                        let source = NSString::from_str(&script_source);
                        let new_script = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                            WKUserScript::alloc(mtm),
                            &source,
                            WKUserScriptInjectionTime::AtDocumentStart,
                            false,
                        );
                        controller.addUserScript(&new_script);
                    }
                }

                Ok(())
            })();

            let _ = tx.try_send(result);
        })
        .map_err(|e| e.to_string())?;

    rx.recv()
        .await
        .ok_or_else(|| "Runtime inject script registration was cancelled".to_string())?
}

#[cfg(target_os = "windows")]
async fn apply_windows_runtime_script<R: Runtime>(
    webview: &Webview<R>,
    state: &RuntimeInjectState,
    marked_script: Option<String>,
) -> Result<(), String> {
    use std::sync::{Arc, Mutex as StdMutex};
    use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
    use windows_core::HSTRING;

    let previous_script_id = state.replace_windows_script_id(None);
    let (tx, mut rx) = tauri::async_runtime::channel::<Result<Option<String>, String>>(1);

    webview
        .with_webview(move |platform_webview| {
            let result = (|| -> Result<Option<String>, String> {
                let core_webview = unsafe { platform_webview.controller().CoreWebView2() }
                    .map_err(|e| e.to_string())?;

                if let Some(old_id) = previous_script_id {
                    let old_id_hstring = HSTRING::from(old_id);
                    if let Err(err) =
                        unsafe { core_webview.RemoveScriptToExecuteOnDocumentCreated(&old_id_hstring) }
                    {
                        log::warn!("Failed to remove previous WebView2 runtime script: {err}");
                    }
                }

                if let Some(script_source) = marked_script {
                    let captured_id = Arc::new(StdMutex::new(None::<String>));
                    let captured_id_cb = Arc::clone(&captured_id);
                    let webview_clone = core_webview.clone();

                    AddScriptToExecuteOnDocumentCreatedCompletedHandler::wait_for_async_operation(
                        Box::new(move |handler| unsafe {
                            let js = HSTRING::from(script_source);
                            webview_clone
                                .AddScriptToExecuteOnDocumentCreated(&js, &handler)
                                .map_err(Into::into)
                        }),
                        Box::new(move |error_code, id| {
                            if error_code.is_ok() {
                                *captured_id_cb.lock().unwrap() = Some(id);
                            }
                            error_code
                        }),
                    )
                    .map_err(|e| e.to_string())?;

                    let new_id = captured_id.lock().unwrap().take();
                    return Ok(new_id);
                }

                Ok(None)
            })();

            let _ = tx.try_send(result);
        })
        .map_err(|e| e.to_string())?;

    let new_script_id = rx
        .recv()
        .await
        .ok_or_else(|| "Runtime inject script registration was cancelled".to_string())??;
    state.replace_windows_script_id(new_script_id);
    Ok(())
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
async fn apply_linux_runtime_script<R: Runtime>(
    webview: &Webview<R>,
    marked_script: Option<String>,
) -> Result<(), String> {
    use std::cell::RefCell;
    use webkit2gtk::{
        UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime,
        WebViewExt,
    };

    thread_local! {
        static ACTIVE_SCRIPT: RefCell<Option<UserScript>> = const { RefCell::new(None) };
    }

    let (tx, mut rx) = tauri::async_runtime::channel::<Result<(), String>>(1);

    webview
        .with_webview(move |platform_webview| {
            let result = (|| -> Result<(), String> {
                let manager = platform_webview
                    .inner()
                    .user_content_manager()
                    .ok_or_else(|| "WebKitUserContentManager is unavailable".to_string())?;

                ACTIVE_SCRIPT.with(|slot| {
                    if let Some(previous) = slot.borrow_mut().take() {
                        manager.remove_script(&previous);
                    }
                });

                if let Some(script_source) = marked_script {
                    let user_script = UserScript::new(
                        &script_source,
                        UserContentInjectedFrames::AllFrames,
                        UserScriptInjectionTime::Start,
                        &[],
                        &[],
                    );
                    manager.add_script(&user_script);
                    ACTIVE_SCRIPT.with(|slot| {
                        *slot.borrow_mut() = Some(user_script);
                    });
                }

                Ok(())
            })();

            let _ = tx.try_send(result);
        })
        .map_err(|e| e.to_string())?;

    rx.recv()
        .await
        .ok_or_else(|| "Runtime inject script registration was cancelled".to_string())?
}
