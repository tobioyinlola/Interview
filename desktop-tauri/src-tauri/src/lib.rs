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
mod files;
mod policy;
mod stealth;
mod window;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Instant;
use tauri::{command, AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

/// When the app started, so the log can say where launch time went (window, page, first paint).
static BOOT: OnceLock<Instant> = OnceLock::new();

fn since_boot() -> u128 {
    BOOT.get().map(|t| t.elapsed().as_millis()).unwrap_or(0)
}

/// Lock a mutex even if a thread panicked while holding it. The data here is plain state, so a
/// poisoned lock must never take the whole app down with it.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ─── Stealth state (mirrors Electron's global variables) ───

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StealthState {
    pub active: bool,
    pub click_through: bool,
}

struct AppState {
    stealth: Mutex<StealthState>,
    normal_bounds: Mutex<Option<(i32, i32, u32, u32)>>, // x, y, width, height
    /// Set once the first page has finished loading (deep links before that are kept for later).
    page_ready: AtomicBool,
    /// A sign-in link that arrived before the page was ready (the app was started by the link).
    pending_link: Mutex<Option<String>>,
    /// The last sign-in link handled: a one-time code is never used twice.
    last_link: Mutex<Option<String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            stealth: Mutex::new(StealthState {
                active: false,
                click_through: false,
            }),
            normal_bounds: Mutex::new(None),
            page_ready: AtomicBool::new(false),
            pending_link: Mutex::new(None),
            last_link: Mutex::new(None),
        }
    }
}

// ─── Stealth mode commands ───

/// Enter stealth mode: morphs the window into a compact floating HUD
/// invisible to all screen capture tools.
///
/// The state lock is only ever held for a moment, never across a window call: window calls wait
/// for the main thread, and the main thread (shortcuts, events) takes this same lock. Holding it
/// across them froze the whole app.
#[command]
async fn stealth_enter<R: Runtime>(
    app: AppHandle<R>,
    win: WebviewWindow<R>,
) -> Result<StealthState, String> {
    let state = app.state::<AppState>();
    {
        let mut stealth = lock(&state.stealth);
        if stealth.active {
            return Ok(stealth.clone());
        }
        stealth.active = true;
        stealth.click_through = false;
    }

    // Save current bounds for restore
    if let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) {
        *lock(&state.normal_bounds) = Some((pos.x, pos.y, size.width, size.height));
    }

    // 1. Hide briefly to prevent flicker during morph
    let _ = win.hide();

    // 2. HUD window style (capture exclusion is always on; this adds the taskbar-less HUD look)
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
    let new_state = lock(&state.stealth).clone();
    let _ = win.emit("stealth-state", &new_state);

    Ok(new_state)
}

/// Exit stealth mode: restore the full desktop window (still hidden from screen capture).
#[command]
async fn stealth_exit<R: Runtime>(
    app: AppHandle<R>,
    win: WebviewWindow<R>,
) -> Result<StealthState, String> {
    let state = app.state::<AppState>();
    let was_click_through = {
        let mut stealth = lock(&state.stealth);
        if !stealth.active {
            return Ok(stealth.clone());
        }
        let was = stealth.click_through;
        stealth.active = false;
        stealth.click_through = false;
        was
    };

    // Disable click-through first
    if was_click_through {
        let _ = win.set_ignore_cursor_events(false);
    }

    // 1. Hide while morphing back
    let _ = win.hide();

    // 2. Back to the normal window style. Capture exclusion stays on: the app is hidden from
    //    screen sharing at all times, not only while the HUD is showing.
    stealth::apply_native_stealth(&win, false);

    // 3. Restore normal window chrome
    let _ = win.set_always_on_top(false);
    let _ = win.set_visible_on_all_workspaces(false);
    let _ = win.set_resizable(true);
    let _ = win.set_min_size(Some(tauri::PhysicalSize::new(420u32, 500u32)));
    let _ = win.set_shadow(true);
    let _ = win.set_skip_taskbar(false);

    // 4. Restore previous bounds
    let bounds = lock(&state.normal_bounds).take();
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
    stealth::re_enforce_stealth(&win);

    // 6. Notify frontend
    let new_state = lock(&state.stealth).clone();
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
    {
        let mut stealth = lock(&state.stealth);
        if !stealth.active {
            return Ok(stealth.clone());
        }
        stealth.click_through = enable;
    }
    let _ = win.set_ignore_cursor_events(enable);

    // Re-enforce stealth since set_ignore_cursor_events might add WS_EX_LAYERED
    stealth::re_enforce_stealth(&win);

    let new_state = lock(&state.stealth).clone();
    let _ = win.emit("stealth-state", &new_state);

    Ok(new_state)
}

/// Query current stealth state.
#[command]
async fn stealth_query<R: Runtime>(app: AppHandle<R>) -> Result<StealthState, String> {
    let state = app.state::<AppState>();
    let current = lock(&state.stealth).clone();
    Ok(current)
}

// ─── App setup ───

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A panic is written to the log file before anything else happens, so a crash always leaves
    // a trace to read.
    std::panic::set_hook(Box::new(|info| log::error!("[panic] {info}")));
    let _ = BOOT.set(Instant::now());

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("interviewmeet".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .max_file_size(1_000_000)
                .build(),
        )
        // Must be the first plugin. A second launch (Windows/Linux hand the interviewmeet:// sign-in
        // link over this way) is forwarded to the running app, which comes to the front.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .manage(audio::AudioState::default())
        .on_page_load(|webview, payload| {
            let what = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            log::info!("[App] page load {what} at {} ms", since_boot());
            if let tauri::webview::PageLoadEvent::Finished = payload.event() {
                let app = webview.app_handle();
                let state = app.state::<AppState>();
                state.page_ready.store(true, Ordering::SeqCst);
                let pending = lock(&state.pending_link).take();
                if let Some(link) = pending {
                    handle_deep_link(app, &link);
                }
            }
        })
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
            window::window_start_drag,
            window::open_in_browser,
            window::open_external,
            window::privacy_set,
            window::privacy_live,
            files::pick_cv,
            // Audio
            audio::list_audio_devices,
            audio::start_audio_capture,
            audio::stop_audio_capture,
        ])
        .setup(|app| {
            // The window is created here (not from tauri.conf.json alone) so the bridge can be
            // injected before any page script runs, like Electron's preload, and so the navigation
            // rules apply from the very first load.
            let cfg = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or("no window configured in tauri.conf.json")?;
            let opener_app = app.handle().clone();
            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?
                .initialization_script(bridge_script(&app.package_info().version.to_string()))
                .on_navigation(move |url| match policy::navigation_decision(url) {
                    policy::Nav::Allow => true,
                    policy::Nav::External => {
                        let _ = opener_app.opener().open_url(url.as_str(), None::<&str>);
                        false
                    }
                    policy::Nav::Deny => false,
                })
                .build()?;

            // Apply capture exclusion on startup (before the window is shown).
            // STRICT REQUIREMENT: App must be hidden from screen sharing at all times.
            // (Normal window style: it keeps its taskbar button until the HUD is entered.)
            stealth::apply_native_stealth(&window, false);

            // The window starts hidden (tauri.conf.json); show it now that stealth is applied.
            let _ = window.show();
            stealth::re_enforce_stealth(&window);
            log::info!("[App] window shown at {} ms", since_boot());

            let win = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Focused(_) = event {
                    // Re-enforce stealth on focus changes
                    stealth::re_enforce_stealth(&win);
                }
            });

            // Register global shortcuts
            if let Err(e) = setup_global_shortcuts(app) {
                log::warn!("[App] global shortcuts unavailable: {e}");
            }

            // Handle deep links (interviewmeet:// protocol)
            if let Err(e) = setup_deep_links(app) {
                log::warn!("[App] deep links unavailable: {e}");
            }

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
        if !lock(&state.stealth).active {
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
            let enable = {
                let mut stealth = lock(&state.stealth);
                stealth.click_through = !stealth.click_through;
                stealth.click_through
            };
            let _ = window.set_ignore_cursor_events(enable);
            stealth::re_enforce_stealth(&window);
            let new_state = lock(&state.stealth).clone();
            let _ = window.emit("stealth-state", &new_state);
        }
    })?;

    Ok(())
}

/// The bridge script with this build's platform, architecture and version filled in.
fn bridge_script(version: &str) -> String {
    let platform = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    include_str!("../bridge.js")
        .replace("__PLATFORM__", platform)
        .replace("__ARCH__", arch)
        .replace("__VERSION__", version)
}

fn setup_deep_links(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_deep_link::DeepLinkExt;

    // interviewmeet:// is how the browser hands the app back after Google sign-in.
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            handle_deep_link(&handle, url.as_str());
        }
    });

    // The app was started by the link itself (Windows/Linux pass it as an argument).
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            handle_deep_link(app.handle(), url.as_str());
        }
    }
    Ok(())
}

/// The browser finished Google sign-in: carry on inside the app's own window, on the app's own
/// address (never the website), exactly as the Electron app does.
fn handle_deep_link<R: Runtime>(app: &AppHandle<R>, link: &str) {
    let Some(query) = policy::parse_auth_link(link) else {
        return;
    };
    let state = app.state::<AppState>();

    // a one-time code is used once
    {
        let mut last = lock(&state.last_link);
        if last.as_deref() == Some(link) {
            return;
        }
        *last = Some(link.to_string());
    }

    // the page is not up yet: keep the link and use it as soon as it is
    if !state.page_ready.load(Ordering::SeqCst) {
        *lock(&state.pending_link) = Some(link.to_string());
        *lock(&state.last_link) = None;
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let target = serde_json::to_string(&format!("/auth/app?{query}")).unwrap_or_default();
        let _ = window.eval(&format!("window.location.assign({target})"));
    }
}
