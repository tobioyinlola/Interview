//! Window control commands: minimize, maximize, close, and click-through.
//!
//! These replace Electron's `ipcMain.handle("im:window-*")` handlers.
//! The frontend calls them via `invoke("window_minimize")` etc.

use tauri::{command, Runtime, WebviewWindow};

#[cfg(target_os = "windows")]
use crate::stealth::re_enforce_stealth;

#[command]
pub async fn window_minimize<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[command]
pub async fn window_maximize<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[command]
pub async fn window_close<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// Set click-through (ignore cursor events) on the window.
/// When `enable` is true, pointer events pass through to whatever is beneath.
/// Re-enforces stealth on Windows since `set_ignore_cursor_events` might add WS_EX_LAYERED.
#[command]
pub async fn set_click_through<R: Runtime>(
    window: WebviewWindow<R>,
    enable: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(enable)
        .map_err(|e| e.to_string())?;

    // On Windows, set_ignore_cursor_events might sneak WS_EX_LAYERED back.
    #[cfg(target_os = "windows")]
    re_enforce_stealth(&window);

    Ok(())
}
