pub(crate) mod inject;
pub(crate) mod itp;
pub(crate) mod storage;

use tauri::{Manager, Runtime, WebviewWindowBuilder};

pub(crate) fn apply_default_webview_settings<'a, R, M, C>(
    manager: &C,
    builder: WebviewWindowBuilder<'a, R, M>,
) -> tauri::Result<WebviewWindowBuilder<'a, R, M>>
where
    R: Runtime,
    M: Manager<R>,
    C: Manager<R>,
{
    let mut builder = storage::setup_shared_data_directory(manager, builder)?;
    let app_config = manager.app_handle().config();
    if let Some(user_agent) = app_config
        .app
        .windows
        .iter()
        .find(|window_config| window_config.label == "main")
        .or_else(|| app_config.app.windows.first())
        .and_then(|window_config| window_config.user_agent.as_deref())
    {
        builder = builder.user_agent(user_agent);
    }
    let builder = inject::inject_startup_scripts(builder);
    Ok(builder)
}
