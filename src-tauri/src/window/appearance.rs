use tauri::{Manager, Runtime, Theme, WebviewWindow, WebviewWindowBuilder};

#[allow(dead_code)]
fn background_color_for_theme(theme: Theme) -> tauri::webview::Color {
    match theme {
        Theme::Dark => tauri::webview::Color(0, 0, 0, 255),
        Theme::Light => tauri::webview::Color(255, 255, 255, 255),
        _ => tauri::webview::Color(255, 255, 255, 255),
    }
}

pub fn apply_platform_decorations<'a, R, M>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
{
    #[cfg(target_os = "macos")]
    {
        builder.title_bar_style(tauri::TitleBarStyle::Transparent)
    }
    #[cfg(not(target_os = "macos"))]
    {
        builder
    }
}

pub fn bind_theme_change_listener<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    #[cfg(desktop)]
    {
        let theme = window.theme().unwrap_or(Theme::Light);
        window.set_background_color(Some(background_color_for_theme(theme)))?;

        let window_for_events = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::ThemeChanged(theme) = event {
                let _ = window_for_events
                    .set_background_color(Some(background_color_for_theme(*theme)));
            }
        });
    }
    #[cfg(not(desktop))]
    {
        let _ = window;
    }

    Ok(())
}

#[allow(dead_code)]
pub fn reveal<R: Runtime>(window: &WebviewWindow<R>, focus: bool) -> tauri::Result<()> {
    #[cfg(desktop)]
    {
        if !window.is_visible()? {
            window.show()?;
        }

        if focus {
            let _ = window.set_focus();
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = window;
        let _ = focus;
    }

    Ok(())
}
