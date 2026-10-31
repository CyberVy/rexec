use tauri::{Manager, Runtime, WebviewWindowBuilder};

pub fn hide_until_page_loaded<'a, R, M>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
{
    #[cfg(desktop)]
    {
        builder
            .background_color(tauri::webview::Color(0, 0, 0, 255))
            .visible(false)
            .on_page_load(|window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            })
    }
    #[cfg(not(desktop))]
    {
        builder
    }
}
