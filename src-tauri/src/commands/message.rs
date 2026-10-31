use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn post_message_to_webview(
    app: AppHandle,
    webview: tauri::Webview,
    label: String,
    message: serde_json::Value,
) -> Result<(), String> {
    if let Some(target_webview) = app.get_webview(&label) {
        let sender_label = webview.label().to_string();
        let js = format!(
            "if (window.__tauri_ipc_dispatch_message_event) {{ window.__tauri_ipc_dispatch_message_event({}, '{}'); }} else {{ window.postMessage({}, '*'); }}",
            message.to_string(),
            sender_label,
            message.to_string()
        );
        target_webview.eval(&js).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn post_message_to_main(
    app: AppHandle,
    webview: tauri::Webview,
    message: serde_json::Value,
) -> Result<(), String> {
    post_message_to_webview(app, webview, "main".to_string(), message)
}
