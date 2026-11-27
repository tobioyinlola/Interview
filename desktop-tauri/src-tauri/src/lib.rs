//! InterviewMeet desktop, on Tauri (a prototype beside the Electron app).
//!
//! The web interface is the same one the Electron app packs; this shell gives it the same small
//! bridge (`window.interviewMeetDesktop`): a CV picker that starts in Downloads, native screen
//! capture protection for private screens, opening the Google sign-in in the real browser, and the
//! `interviewmeet://` link that hands sign-in back. What this prototype does NOT have yet, and why,
//! is written down in ../PROTOTYPE.md: live-interview system audio and the Auto-Apply workspace.

mod policy;

use std::sync::Mutex;
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;

const CV_MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Default)]
struct Session {
    live: Mutex<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CvPick {
    name: String,
    data: Option<Vec<u8>>,
    too_big: bool,
}

/// The system file picker, starting in Downloads. None when cancelled.
#[tauri::command]
async fn pick_cv(app: tauri::AppHandle) -> Result<Option<CvPick>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose your CV")
        .add_filter("CV (PDF, Word or text)", &["pdf", "docx", "txt"])
        .add_filter("All files", &["*"]);
    if let Ok(dir) = app.path().download_dir() {
        dialog = dialog.set_directory(dir);
    }
    let Some(picked) = dialog.blocking_pick_file() else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > CV_MAX_BYTES {
        return Ok(Some(CvPick { name, data: None, too_big: true }));
    }
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(CvPick { name, data: Some(data), too_big: false }))
}

/// Native protection from screen capture, for the app's own private screens only.
#[tauri::command]
fn set_privacy(window: WebviewWindow, session: tauri::State<Session>, on: bool) -> bool {
    let live = *session.live.lock().unwrap();
    let from_app = window.url().map(|u| matches!(u.scheme(), "tauri" | "http" | "https") && u.host_str().map_or(true, |h| h == "tauri.localhost" || h == "localhost")).unwrap_or(false);
    let active = policy::privacy_decision(on, live, from_app);
    let _ = window.set_content_protected(active);
    active
}

/// A live interview session is starting or ending: protection is switched off during one.
#[tauri::command]
fn set_privacy_live(window: WebviewWindow, session: tauri::State<Session>, on: bool) {
    *session.live.lock().unwrap() = on;
    if on {
        let _ = window.set_content_protected(false);
    }
}

#[tauri::command]
fn open_in_browser(url: String) {
    let site = std::env::var("INTERVIEWMEET_URL").unwrap_or_default();
    if policy::is_google_start_url(&url, site.trim_end_matches('/')) {
        let _ = open::that(url);
    }
}

fn handle_link(app: &tauri::AppHandle, link: &str) {
    if let Some(query) = policy::parse_auth_link(link) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.emit("im://auth", query);
        }
    }
}

const BRIDGE: &str = r#"
(() => {
  const inv = (c, a) => window.__TAURI_INTERNALS__.invoke(c, a);
  Object.defineProperty(window, "interviewMeetDesktop", { value: Object.freeze({
    isDesktop: true,
    platform: __PLATFORM__,
    arch: __ARCH__,
    systemAudio: false,
    openInBrowser: (url) => { if (typeof url === "string") void inv("open_in_browser", { url }); },
    pickCv: () => inv("pick_cv"),
    privacy: Object.freeze({
      set: (on) => inv("set_privacy", { on: on === true }).then((active) => ({ active })),
      setLive: (on) => inv("set_privacy_live", { on: on === true }),
    }),
    openWorkspace: () => Promise.resolve(false),
  }), enumerable: true });
  window.addEventListener("DOMContentLoaded", () => {
    window.__TAURI_INTERNALS__.transformCallback; // the event below is consumed by the app shell
  });
})();
"#;

pub fn run() {
    let platform = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let script = BRIDGE
        .replace("__PLATFORM__", &format!("{platform:?}"))
        .replace("__ARCH__", &format!("{:?}", std::env::consts::ARCH));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for a in argv.iter().skip(1) {
                handle_link(app, a);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(Session::default())
        .invoke_handler(tauri::generate_handler![pick_cv, set_privacy, set_privacy_live, open_in_browser])
        .setup(move |app| {
            let handle = app.handle().clone();
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            app.deep_link().on_open_url(move |event| {
                for u in event.urls() {
                    handle_link(&handle, u.as_str());
                }
            });
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("InterviewMeet")
                .inner_size(1280.0, 860.0)
                .min_inner_size(900.0, 640.0)
                .initialization_script(&script)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running InterviewMeet");
}
