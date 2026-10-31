use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Runtime;

#[cfg(desktop)]
use tauri::{LogicalPosition, LogicalSize, Manager};

#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
pub struct LayoutItem {
    pub label: String,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Default)]
pub struct WindowLayoutState {
    #[allow(dead_code)]
    pub active_layouts: Mutex<HashMap<String, Vec<LayoutItem>>>,
}

impl WindowLayoutState {
    pub fn apply_layout<R: Runtime>(&self, window: &tauri::Window<R>) -> tauri::Result<()> {
        #[cfg(desktop)]
        {
            let label = window.label();
            let scale_factor = window.scale_factor()?;
            let inner_size = window.inner_size()?.to_logical::<f64>(scale_factor);
            let manager = window.app_handle();

            let layouts_map = self.active_layouts.lock().unwrap();
            if let Some(items) = layouts_map.get(label) {
                for item in items.iter() {
                    if let Some(webview) = manager.get_webview(&item.label) {
                        let x = inner_size.width * item.left;
                        let y = inner_size.height * item.top;
                        let w = inner_size.width * item.width;
                        let h = inner_size.height * item.height;

                        webview.set_position(LogicalPosition::new(x, y))?;
                        webview.set_size(LogicalSize::new(w, h))?;
                    }
                }
            }
        }
        #[cfg(not(desktop))]
        {
            let _ = window;
        }
        Ok(())
    }
}
