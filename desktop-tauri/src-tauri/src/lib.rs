//! InterviewMeet Desktop — Tauri 2 Application
//!
//! Replaces the Electron desktop app with a native Tauri 2 app that provides:
//!   - Stealth HUD completely invisible to screen capture (WDA_EXCLUDEFROMCAPTURE)
//!   - System audio capture via WASAPI loopback (Windows) / ScreenCaptureKit (macOS)
//!   - Frameless, always-on-top floating HUD with click-through
//!   - Auto-update via GitHub Releases
//!   - OAuth deep link handling (interviewmeet:// protocol)
//!   - Global keyboard shortcuts
//!
//! The frontend is the same React app from `frontend/` — only the native bridge changes.

mod audio;
mod stealth;
mod window;

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, Manager, Runtime, WebviewWindow};

// ─── Stealth state (mirrors Electron's global variables) ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StealthState {
    pub active: bool,
    pub click_through: bool,
}

struct AppState {
    stealth: Mutex<StealthState>,
    normal_bounds: Mutex<Option<(i32, i32, u32, u32)>>, // x, y, width, height
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            stealth: Mutex::new(StealthState {
                active: false,
                click_through: false,
            }),
            normal_bounds: Mutex::new(None),
        }
    }
}

// ─── Stealth mode commands ───

/// Enter stealth mode: morphs the window into a compact floating HUD
/// invisible to all screen capture tools.
#[command]
async fn stealth_enter<R: Runtime>(
    app: AppHandle<R>,
    win: WebviewWindow<R>,
) -> Result<StealthState, String> {
    let state = app.state::<AppState>();
    let mut stealth = state.stealth.lock().map_err(|e| e.to_string())?;

    if stealth.active {
        return Ok(stealth.clone());
    }

    stealth.active = true;
    stealth.click_through = false;

    // Save current bounds for restore
    if let Ok(pos) = win.outer_position() {
        if let Ok(size) = win.outer_size() {
            *state.normal_bounds.lock().unwrap() =
                Some((pos.x, pos.y, size.width, size.height));
        }
    }

    // 1. Hide briefly to prevent flicker during morph
    let _ = win.hide();

    // 2. Apply native stealth (WDA_EXCLUDEFROMCAPTURE on Windows, content protection on macOS)
    stealth::apply_native_stealth(&win, true);

    // 3. Morph into compact floating HUD
    let _ = win.set_min_size(Some(tauri::PhysicalSize::new(300u32, 300u32)));
    let _ = win.set_resizable(false);
    let _ = win.set_shadow(false);
    let _ = win.set_always_on_top(true);
    let _ = win.set_visible_on_all_workspaces(true);
    let _ = win.set_skip_taskbar(true);

    // Position: right side of screen, near top
    if let Some(monitor) = win.current_monitor().ok().flatten() {
        let screen_width = monitor.size().width;
        let target_x = (screen_width as i32 - 470).max(20);
        let _ = win.set_position(tauri::PhysicalPosition::new(target_x, 30));
    }
    let _ = win.set_size(tauri::PhysicalSize::new(450u32, 680u32));

    // 4. Show without stealing focus
    let _ = win.show();

    // 5. Re-enforce stealth after show (Windows: SetWindowDisplayAffinity can be lost)
    stealth::re_enforce_stealth(&win);

    // 6. Notify frontend
    let new_state = stealth.clone();
    let _ = win.emit("stealth-state", &new_state);

    Ok(new_state)
}

/// Exit stealth mode: restore the full desktop window.
#[command]
async fn stealth_exit<R: Runtime>(
    app: AppHandle<R>,
    win: WebviewWindow<R>,
) -> Result<StealthState, String> {
    let state = app.state::<AppState>();
    let mut stealth = state.stealth.lock().map_err(|e| e.to_string())?;

    if !stealth.active {
        return Ok(stealth.clone());
    }

    // Disable click-through first
    if stealth.click_through {
        stealth.click_through = false;
        let _ = win.set_ignore_cursor_events(false);
    }

    stealth.active = false;

    // 1. Hide while morphing back
    let _ = win.hide();

    // 2. Remove stealth native flags
    stealth::apply_native_stealth(&win, false);

    // 3. Restore normal window chrome
    let _ = win.set_always_on_top(false);
    let _ = win.set_visible_on_all_workspaces(false);
    let _ = win.set_resizable(true);
    let _ = win.set_min_size(Some(tauri::PhysicalSize::new(420u32, 500u32)));
    let _ = win.set_shadow(true);
    let _ = win.set_skip_taskbar(false);

    // 4. Restore previous bounds
    let bounds = state.normal_bounds.lock().unwrap().take();
    if let Some((x, y, w, h)) = bounds {
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        let _ = win.set_size(tauri::PhysicalSize::new(w, h));
    } else {
        let _ = win.set_size(tauri::PhysicalSize::new(1280u32, 860u32));
        let _ = win.center();
    }

    // 5. Show and focus
    let _ = win.show();
    let _ = win.set_focus();

    // 6. Notify frontend
    let new_state = stealth.clone();
    let _ = win.emit("stealth-state", &new_state);

    Ok(new_state)
}

/// Toggle stealth mode on/off.
#[command]
async fn stealth_set_mode<R: Runtime>(
    app: AppHandle<R>,
    win: WebviewWindow<R>,
    enable: bool,
) -> Result<StealthState, String> {
    if enable {
        stealth_enter(app, win).await
    } else {
        stealth_exit(app, win).await
    }
}

/// Set click-through on the stealth HUD.
#[command]
async fn stealth_set_click_through<R: Runtime>(
    app: AppHandle<R>,
    win: WebviewWindow<R>,
    enable: bool,
) -> Result<StealthState, String> {
    let state = app.state::<AppState>();
    let mut stealth = state.stealth.lock().map_err(|e| e.to_string())?;

    if !stealth.active {
        return Ok(stealth.clone());
    }

    stealth.click_through = enable;
    let _ = win.set_ignore_cursor_events(enable);

    // Re-enforce stealth since set_ignore_cursor_events might add WS_EX_LAYERED
    stealth::re_enforce_stealth(&win);

    let new_state = stealth.clone();
    let _ = win.emit("stealth-state", &new_state);

    Ok(new_state)
}

/// Query current stealth state.
#[command]
async fn stealth_query<R: Runtime>(app: AppHandle<R>) -> Result<StealthState, String> {
    let state = app.state::<AppState>();
    let stealth = state.stealth.lock().map_err(|e| e.to_string())?;
    Ok(stealth.clone())
}

// ─── App setup ───

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .manage(audio::AudioState::default())
        .invoke_handler(tauri::generate_handler![
            // Stealth
            stealth_enter,
            stealth_exit,
            stealth_set_mode,
            stealth_set_click_through,
            stealth_query,
            // Window controls
            window::window_minimize,
            window::window_maximize,
            window::window_close,
            window::set_click_through,
            // Audio
            audio::list_audio_devices,
            audio::start_audio_capture,
            audio::stop_audio_capture,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").expect("main window not found");

            // Apply capture exclusion on startup (before the window is shown).
            // STRICT REQUIREMENT: App must be hidden from screen sharing at all times.
            stealth::apply_native_stealth(&window, true);

            // The window starts hidden (tauri.conf.json); show it now that stealth is applied.
            let _ = window.show();
            stealth::re_enforce_stealth(&window);

            let win = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(_) = event {
                    // Re-enforce stealth on focus changes
                    stealth::re_enforce_stealth(&win);
                }
            });

            // Register global shortcuts
            setup_global_shortcuts(app)?;

            // Handle deep links (interviewmeet:// protocol)
            setup_deep_links(app)?;

            log::info!("[App] InterviewMeet Tauri desktop app started");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running InterviewMeet");
}

fn setup_global_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    // Ctrl+Shift+H: Toggle HUD visibility (hide/show while in stealth)
    let toggle_hud: Shortcut = "CommandOrControl+Shift+H".parse()?;
    // Ctrl+Shift+M: Toggle click-through mode
    let toggle_mouse: Shortcut = "CommandOrControl+Shift+M".parse()?;

    app.global_shortcut().on_shortcuts([toggle_hud, toggle_mouse], move |app, shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }

        let Some(window) = app.get_webview_window("main") else { return };
        let state = app.state::<AppState>();
        let stealth = state.stealth.lock().unwrap();

        if !stealth.active {
            return;
        }

        if shortcut == &toggle_hud {
            // Toggle HUD visibility
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
            } else {
                let _ = window.show();
                stealth::re_enforce_stealth(&window);
            }
        } else if shortcut == &toggle_mouse {
            // Toggle click-through
            drop(stealth); // Release lock before modifying
            let mut stealth = state.stealth.lock().unwrap();
            stealth.click_through = !stealth.click_through;
            let enable = stealth.click_through;
            let _ = window.set_ignore_cursor_events(enable);
            stealth::re_enforce_stealth(&window);
            let new_state = stealth.clone();
            let _ = window.emit("stealth-state", &new_state);
        }
    })?;

    Ok(())
}

fn setup_deep_links(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Deep link handler for interviewmeet:// protocol
    // The frontend handles the OAuth callback in its router
    let handle = app.handle().clone();
    use tauri_plugin_deep_link::DeepLinkExt;
    app.deep_link().on_open_url(move |event| {
        let urls = event.urls();
        log::info!("[DeepLink] Received: {:?}", urls);
        for url in urls {
            let url_str = url.as_str();
            // Parse the auth callback: interviewmeet://auth?code=...
            if url_str.contains("auth") {
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    // Navigate to the auth callback URL in the webview
                    if let Some(query) = parse_auth_link(url_str) {
                        let nav_url = format!("{}/auth/app?{}", get_app_origin(), query);
                        let _ = window.eval(&format!("window.location.href = '{}'", nav_url));
                    }
                }
            }
        }
    });

    Ok(())
}

/// Parse an interviewmeet://auth?code=... link (mirrors policy.js parseAuthLink).
fn parse_auth_link(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "interviewmeet" || parsed.host_str() != Some("auth") {
        return None;
    }
    if let Some(code) = parsed.query_pairs().find(|(k, _)| k == "code") {
        let val = code.1.as_ref();
        // Validate: 20-200 chars, alphanumeric + _ -
        if val.len() >= 20
            && val.len() <= 200
            && val
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        {
            return Some(format!("code={}", val));
        }
    }
    if let Some(error) = parsed.query_pairs().find(|(k, _)| k == "error") {
        let val = error.1.as_ref();
        if val.len() >= 1
            && val.len() <= 40
            && val.chars().all(|c| c.is_ascii_lowercase() || c == '_')
        {
            return Some(format!("error={}", val));
        }
    }
    None
}

/// Get the app origin URL from environment or config.
fn get_app_origin() -> String {
    std::env::var("INTERVIEWMEET_URL")
        .unwrap_or_else(|_| "https://frontend-dev-2d437f97.up.railway.app".to_string())
}
