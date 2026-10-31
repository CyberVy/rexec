use crate::window::layout::{LayoutItem, WindowLayoutState};
use tauri::{AppHandle, Manager, State, Window};

#[cfg(desktop)]
use tauri::{LogicalPosition, LogicalSize, Url, WebviewBuilder, WebviewUrl};

#[tauri::command]
pub async fn create_child_webview(
    window: Window,
    app: AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        // Check if webview already exists
        if app.get_webview(&label).is_some() {
            return Ok(());
        }

        let parsed_url = url
            .parse::<Url>()
            .map_err(|e| format!("invalid url: {e}"))?;

        let inject_script = include_str!("../inject.js").trim();
        let mut webview_builder =
            WebviewBuilder::new(&label, WebviewUrl::External(parsed_url)).auto_resize();

        let label_script = format!(
            "window.__TAURI_WEBVIEW_LABEL__ = '{}'; window.__TAURI_OPENER_LABEL__ = '{}';",
            label,
            window.label()
        );
        webview_builder = webview_builder.initialization_script(&label_script);

        if !inject_script.is_empty() {
            webview_builder = webview_builder.initialization_script(inject_script);
        }

        window
            .add_child(
                webview_builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(0.0, 0.0),
            )
            .map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = window;
        let _ = app;
        let _ = label;
        let _ = url;
        Err("Child webviews are not supported on this platform".to_string())
    }
}

#[tauri::command]
pub async fn destroy_child_webview(
    app: AppHandle,
    state: State<'_, WindowLayoutState>,
    label: String,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(webview) = app.get_webview(&label) {
            webview.close().map_err(|e| e.to_string())?;
        }

        // Remove from active layouts
        let mut layouts = state.active_layouts.lock().unwrap();
        for items in layouts.values_mut() {
            items.retain(|item| item.label != label);
        }

        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        let _ = state;
        let _ = label;
        Err("Child webviews are not supported on this platform".to_string())
    }
}

#[tauri::command]
pub async fn set_window_layout(
    window: Window,
    state: State<'_, WindowLayoutState>,
    items: Vec<LayoutItem>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let window_label = window.label().to_string();

        {
            let mut layouts = state.active_layouts.lock().unwrap();
            layouts.insert(window_label, items);
        }

        // Apply the layout immediately
        state.apply_layout(&window).map_err(|e| e.to_string())?;

        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = window;
        let _ = state;
        let _ = items;
        Err("Window layout is not supported on this platform".to_string())
    }
}
