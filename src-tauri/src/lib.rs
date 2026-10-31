use tauri::Manager;

mod commands;
mod logging;
mod webview;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    window::state_persistence::register_window_state_plugin(tauri::Builder::default())
        .manage(window::layout::WindowLayoutState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Resized(_) = event {
                if let Some(layout_state) = window.try_state::<window::layout::WindowLayoutState>()
                {
                    let _ = layout_state.apply_layout::<tauri::Wry>(window);
                }
            }
        })
        .setup(|app| {
            logging::init(app)?;
            window::create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fetch::fetch,
            commands::layout::create_child_webview,
            commands::layout::destroy_child_webview,
            commands::layout::set_window_layout,
            commands::message::post_message_to_main,
            commands::message::post_message_to_webview
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
