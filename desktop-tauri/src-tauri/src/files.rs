//! The CV picker. Port of Electron's `im:pick-cv` (desktop/src/main.js).
//!
//! The web page's own file input opens wherever the system last left off, which for a packaged
//! Windows app is the app's data folder. This dialog starts in Downloads instead.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use tauri::{command, AppHandle, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

/// Same limit as the Electron app and the upload endpoint.
const CV_MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedCv {
    pub name: String,
    /// The file's bytes, base64 (the bridge turns it back into a Uint8Array).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    pub too_big: bool,
}

/// Ask for a CV. `None` when cancelled.
#[command]
pub async fn pick_cv<R: Runtime>(app: AppHandle<R>) -> Result<Option<PickedCv>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose your CV")
        .add_filter("CV (PDF, Word or text)", &["pdf", "docx", "txt"])
        .add_filter("All files", &["*"]);
    if let Ok(downloads) = app.path().download_dir() {
        dialog = dialog.set_directory(downloads);
    }

    // Async commands run off the main thread, which the blocking dialog call requires.
    let Some(picked) = dialog.blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "cv".to_string());

    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > CV_MAX_BYTES {
        return Ok(Some(PickedCv { name, data: None, too_big: true }));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(PickedCv {
        name,
        data: Some(STANDARD.encode(bytes)),
        too_big: false,
    }))
}
