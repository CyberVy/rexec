use tauri::{App, Runtime, WebviewWindowBuilder};

pub(crate) fn create_main_window_builder<'a, R: Runtime>(
    app: &'a App<R>,
) -> tauri::Result<WebviewWindowBuilder<'a, R, App<R>>> {
    let main_window_config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window_config| window_config.label == "main")
        .or_else(|| app.config().app.windows.first())
        .expect("main window config not found");

    let webview_builder = WebviewWindowBuilder::from_config(app, main_window_config)?;
    Ok(super::no_flicker::hide_until_page_loaded(webview_builder))
}

pub(crate) fn create_main_window<R: Runtime>(app: &mut App<R>) -> tauri::Result<()> {
    crate::webview::itp::disable();

    let app_handle = app.handle();
    let webview_builder = create_main_window_builder(app)?;
    let webview_builder = super::appearance::apply_platform_decorations(webview_builder);

    #[cfg(desktop)]
    let webview_builder = {
        let webview_builder = webview_builder.visible(false);
        super::popup::register_popup_webview_handler(app_handle, webview_builder)
    };

    let webview_builder =
        crate::webview::apply_default_webview_settings(app_handle, webview_builder)?;

    let main_window = webview_builder.build()?;
    super::appearance::bind_theme_change_listener(&main_window)?;
    Ok(())
}
