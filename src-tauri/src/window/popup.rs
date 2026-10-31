#[cfg(desktop)]
use std::sync::atomic::{AtomicUsize, Ordering};

#[cfg(desktop)]
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

#[cfg(desktop)]
static POPUP_WINDOW_COUNTER: AtomicUsize = AtomicUsize::new(0);

#[cfg(desktop)]
fn default_size<R: Runtime>(app: &AppHandle<R>) -> (f64, f64) {
    let main_window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window_config| window_config.label == "main")
        .or_else(|| app.config().app.windows.first())
        .expect("main window config not found");

    (main_window_config.width, main_window_config.height)
}

#[cfg(desktop)]
pub(crate) fn register_popup_webview_handler<'a, R, M, C>(
    manager: &C,
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
    C: Manager<R>,
{
    let app = manager.app_handle().clone();

    builder.on_new_window(move |url, features| {
        let opener_label = app
            .webview_windows()
            .values()
            .find(|w| w.is_focused().unwrap_or(false))
            .map(|w| w.label().to_string())
            .unwrap_or_else(|| "main".to_string());

        let popup_label = format!(
            "popup-{}",
            POPUP_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        let mut webview_builder =
            create_popup_window_builder(&app, popup_label.clone(), &url, features).visible(false);

        webview_builder = crate::window::appearance::apply_platform_decorations(webview_builder);
        webview_builder = register_popup_webview_handler(&app, webview_builder);

        // Apply default webview settings
        let mut webview_builder =
            match crate::webview::apply_default_webview_settings(&app, webview_builder) {
                Ok(configured_builder) => configured_builder,
                Err(error) => {
                    log::error!("failed to apply default webview settings for popup: {error}");
                    return tauri::webview::NewWindowResponse::Deny;
                }
            };

        // Inject script to set window label and opener label
        let label_script = format!(
            "window.__TAURI_WEBVIEW_LABEL__ = '{}'; window.__TAURI_OPENER_LABEL__ = '{}';",
            popup_label, opener_label
        );
        webview_builder = webview_builder.initialization_script(&label_script);

        // Inject custom script
        let inject_script = include_str!("../inject.js").trim();
        if !inject_script.is_empty() {
            webview_builder = webview_builder.initialization_script(inject_script);
        }

        // Build and reveal popup window
        match webview_builder.build() {
            Ok(popup_window) => {
                let _ = crate::window::appearance::bind_theme_change_listener(&popup_window);
                let _ = crate::window::appearance::reveal(&popup_window, true);
            }
            Err(error) => {
                log::error!("failed to build popup window for {url}: {error}");
            }
        }

        tauri::webview::NewWindowResponse::Deny
    })
}

#[cfg(desktop)]
pub(crate) fn create_popup_window_builder<'a, R: Runtime>(
    app: &'a AppHandle<R>,
    label: String,
    url: &tauri::Url,
    features: tauri::webview::NewWindowFeatures,
) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    let (default_width, default_height) = default_size(app);

    let mut webview_builder =
        WebviewWindowBuilder::new(app, label, WebviewUrl::External(url.clone()))
            .title(url.as_str())
            .on_document_title_changed(|webview, title| {
                let _ = webview.set_title(&title);
            });

    if let Some(size) = features.size() {
        webview_builder = webview_builder.inner_size(size.width, size.height);
    } else {
        webview_builder = webview_builder.inner_size(default_width, default_height);
    }

    if let Some(position) = features.position() {
        webview_builder = webview_builder.position(position.x, position.y);
    }

    #[cfg(not(target_os = "macos"))]
    {
        webview_builder = webview_builder.window_features(features);
    }

    webview_builder
}
