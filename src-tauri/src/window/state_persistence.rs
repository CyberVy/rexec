use tauri::{Builder, Runtime};

pub fn register_window_state_plugin<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    #[cfg(desktop)]
    {
        let state_flags = tauri_plugin_window_state::StateFlags::all()
            & !tauri_plugin_window_state::StateFlags::VISIBLE;

        builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(state_flags)
                .map_label(|label| {
                    if label.starts_with("popup-") {
                        "popup"
                    } else {
                        label
                    }
                })
                .build(),
        )
    }
    #[cfg(not(desktop))]
    {
        builder
    }
}
