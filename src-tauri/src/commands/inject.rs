use crate::webview::runtime_inject::{apply_runtime_inject_script, RuntimeInjectState};
use tauri::{State, Webview};

#[tauri::command]
pub async fn set_runtime_inject_script(
    webview: Webview,
    state: State<'_, RuntimeInjectState>,
    script: String,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("set_runtime_inject_script is only allowed from the main webview".to_string());
    }

    apply_runtime_inject_script(&webview, &state, &script).await
}
