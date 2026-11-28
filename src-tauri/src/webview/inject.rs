use crate::webview::runtime_inject::RuntimeInjectState;
use tauri::{Manager, Runtime, WebviewWindowBuilder};

#[cfg(desktop)]
use tauri::WebviewBuilder;

const INJECT_SCRIPT: &str = include_str!("../inject.js");

fn current_runtime_script<R: Runtime, C: Manager<R>>(manager: &C) -> Option<String> {
    manager
        .try_state::<RuntimeInjectState>()
        .and_then(|state| state.current_script())
}

pub fn inject_startup_scripts<'a, R, M, C>(
    manager: &C,
    mut builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
    C: Manager<R>,
{
    let inject_script = INJECT_SCRIPT.trim();
    if !inject_script.is_empty() {
        builder = builder.initialization_script_for_all_frames(inject_script);
    }

    if let Some(runtime_script) = current_runtime_script(manager) {
        builder = builder.initialization_script_for_all_frames(runtime_script);
    }

    builder
}

#[cfg(desktop)]
pub fn inject_child_webview_scripts<R, C>(
    manager: &C,
    mut builder: WebviewBuilder<R>,
) -> WebviewBuilder<R>
where
    R: Runtime,
    C: Manager<R>,
{
    let inject_script = INJECT_SCRIPT.trim();
    if !inject_script.is_empty() {
        builder = builder.initialization_script_for_all_frames(inject_script);
    }

    if let Some(runtime_script) = current_runtime_script(manager) {
        builder = builder.initialization_script_for_all_frames(runtime_script);
    }

    builder
}
