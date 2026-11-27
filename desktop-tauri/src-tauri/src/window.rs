//! Window control commands: minimize, maximize, close, and click-through.
//!
//! These replace Electron's `ipcMain.handle("im:window-*")` handlers.
//! The frontend calls them via `invoke("window_minimize")` etc.

use crate::policy::{self, Nav};
use tauri::{command, AppHandle, Runtime, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

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

/// Start dragging the window (the interface marks its title bar / HUD handle as a drag region).
#[command]
pub async fn window_start_drag<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

/// Open the app's own Google sign-in address in the person's real browser (Google refuses embedded
/// windows). Mirrors Electron's `im:open-in-browser`: nothing else may be opened this way.
#[command]
pub async fn open_in_browser<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    if !policy::is_google_start_url(&url, &policy::site_origin()) {
        return Err("address not allowed".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Open an ordinary link (https or mail) in the normal browser, like Electron's window-open handler.
#[command]
pub async fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if policy::navigation_decision(&parsed) != Nav::External {
        return Err("address not allowed".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct PrivacyResult {
    pub active: bool,
}

/// Private screens ask for capture protection. The window is always excluded from screen capture
/// (AGENTS.md: hidden from sharing, proctoring and monitoring tools at all times), so this only
/// re-asserts it and reports that it is on.
#[command]
pub async fn privacy_set<R: Runtime>(window: WebviewWindow<R>, on: bool) -> Result<PrivacyResult, String> {
    let _ = on;
    crate::stealth::re_enforce_stealth(&window);
    Ok(PrivacyResult { active: true })
}

/// The live-session flag. It never switches protection off, so there is nothing to do.
#[command]
pub async fn privacy_live(on: bool) -> Result<(), String> {
    let _ = on;
    Ok(())
}
