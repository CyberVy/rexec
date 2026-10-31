use tauri::{Manager, Runtime, WebviewWindowBuilder};

const INJECT_SCRIPT: &str = include_str!("../inject.js");

pub fn inject_startup_scripts<'a, R, M>(
    builder: WebviewWindowBuilder<'a, R, M>,
) -> WebviewWindowBuilder<'a, R, M>
where
    R: Runtime,
    M: Manager<R>,
{
    let inject_script = INJECT_SCRIPT.trim();

    if inject_script.is_empty() {
        builder
    } else {
        builder.initialization_script_for_all_frames(inject_script)
    }
}
