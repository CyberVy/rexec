use tauri::{App, Runtime};

pub fn init<R: Runtime>(app: &mut App<R>) -> tauri::Result<()> {
    if cfg!(debug_assertions) {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )?;
    }

    Ok(())
}
