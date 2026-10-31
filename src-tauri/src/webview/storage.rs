use tauri::{Manager, Runtime, WebviewWindowBuilder};

pub fn setup_shared_data_directory<'a, R, M, C>(
    manager: &C,
    #[allow(unused_mut)] mut builder: WebviewWindowBuilder<'a, R, M>,
) -> tauri::Result<WebviewWindowBuilder<'a, R, M>>
where
    R: Runtime,
    M: Manager<R>,
    C: Manager<R>,
{
    let _ = manager;

    #[cfg(target_os = "macos")]
    {
        builder = builder.data_store_identifier(*b"shared-dstore-v1");
    }

    #[cfg(target_os = "windows")]
    {
        let shared_dir = manager.path().app_data_dir()?.join("shared-webview");
        std::fs::create_dir_all(&shared_dir)?;
        builder = builder.data_directory(shared_dir).incognito(false);
    }

    Ok(builder)
}
