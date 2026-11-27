//! Stealth capture exclusion for Windows and macOS.
//!
//! Windows:
//!   - `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` hides the window
//!     from every screen-capture API (OBS, Zoom, Teams, Discord, proctoring tools).
//!   - Unlike Electron, Tauri/WebView2 does NOT use `WS_EX_LAYERED` for transparency
//!     or compositing, so `SetWindowDisplayAffinity` works without any hacks.
//!   - We still strip `WS_EX_LAYERED` defensively in case any Win32 API adds it.
//!
//! macOS:
//!   - `setSharingType(NSWindowSharingNone)` via `set_content_protected(true)`.
//!   - Hides the Dock icon in stealth mode so it doesn't appear in Alt-Tab / Cmd-Tab.

#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{Runtime, WebviewWindow};

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
    GWL_EXSTYLE, HWND_TOP, SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_TOOLWINDOW,
};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;

/// Windows Display Affinity values
#[cfg(target_os = "windows")]
const WDA_EXCLUDEFROMCAPTURE: u32 = 0x00000011;

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn SetWindowDisplayAffinity(hwnd: HWND, dw_affinity: u32) -> i32;
    fn GetWindowDisplayAffinity(hwnd: HWND, pdw_affinity: *mut u32) -> i32;
}

/// Get the HWND from a Tauri window (Windows only)
#[cfg(target_os = "windows")]
fn get_hwnd(window: &WebviewWindow<impl Runtime>) -> Option<HWND> {
    window.hwnd().ok().map(|h| HWND(h.0))
}

/// Apply or remove native stealth protection.
///
/// Capture exclusion is applied every time, whatever `hud` says.
///
/// `hud` true (the floating HUD):
///   - Windows: also adds WS_EX_TOOLWINDOW (no taskbar button)
///   - macOS: also hides the Dock icon
///
/// `hud` false (the normal window):
///   - Windows: restores the taskbar button
///   - macOS: shows the Dock icon
#[cfg(target_os = "windows")]
pub fn apply_native_stealth(window: &WebviewWindow<impl Runtime>, hud: bool) {
    let enable = hud;
    let Some(hwnd) = get_hwnd(window) else {
        log::error!("[Stealth] Could not get HWND");
        return;
    };

    unsafe {
        // 1. Read current extended styles
        let current_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as isize;

        // 2. Build new style: always strip WS_EX_LAYERED (defensive)
        // HUD: no taskbar button. Normal window: taskbar button back. Never layered.
        let new_style = if enable {
            (current_style | WS_EX_TOOLWINDOW.0 as isize)
                & !(WS_EX_APPWINDOW.0 as isize)
                & !(WS_EX_LAYERED.0 as isize)
        } else {
            ((current_style & !(WS_EX_TOOLWINDOW.0 as isize)) | WS_EX_APPWINDOW.0 as isize)
                & !(WS_EX_LAYERED.0 as isize)
        };

        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);

        // Force Windows to apply the style change
        let _ = SetWindowPos(
            hwnd,
            HWND_TOP,
            0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        );

        // 3. Apply or clear capture exclusion
        // Capture exclusion is never switched off: the app stays hidden from screen sharing
        // outside the HUD too.
        let ok = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);

        // 4. Verify
        let mut active_affinity: u32 = 0;
        GetWindowDisplayAffinity(hwnd, &mut active_affinity);

        let layered = (new_style as u32) & WS_EX_LAYERED.0 != 0;
        log::info!(
            "[Stealth] enable={} hwnd={:?} ok={} affinity=0x{:x} layered={}",
            enable, hwnd, ok, active_affinity, layered
        );

        if ok == 0 {
            log::error!(
                "[Stealth] FAILED to set WDA_EXCLUDEFROMCAPTURE! Check for WS_EX_LAYERED."
            );
        }
    }
}

/// Re-enforce capture exclusion after an operation that might have added WS_EX_LAYERED.
/// Call after any window property change when stealth is active.
#[cfg(target_os = "windows")]
pub fn re_enforce_stealth(window: &WebviewWindow<impl Runtime>) {
    let Some(hwnd) = get_hwnd(window) else { return };

    unsafe {
        let current_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;

        if current_style & WS_EX_LAYERED.0 != 0 {
            log::warn!("[Stealth] WS_EX_LAYERED detected — stripping and re-applying affinity");
            let clean = (current_style & !WS_EX_LAYERED.0) as isize;
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, clean);
            let _ = SetWindowPos(
                hwnd,
                HWND_TOP,
                0, 0, 0, 0,
                SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            );
            let ok = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
            log::info!("[Stealth] re-enforce: ok={}", ok);
        }
    }
}

#[cfg(target_os = "macos")]
pub fn apply_native_stealth(window: &WebviewWindow<impl Runtime>, hud: bool) {
    let enable = hud;
    // macOS: content protection hides from ScreenCaptureKit, CGWindowListCreateImage, etc.
    // It stays on in the normal window too.
    let _ = window.set_content_protected(true);

    // Hide/show Dock icon to remove from Cmd-Tab
    let app = window.app_handle();
    if enable {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    } else {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    }

    log::info!("[Stealth] macOS: hud={} content_protected=true", enable);
}

#[cfg(target_os = "macos")]
pub fn re_enforce_stealth(window: &WebviewWindow<impl Runtime>) {
    // macOS: re-assert content protection (WindowServer can reset sharingType)
    let _ = window.set_content_protected(true);
}

// Linux is not a supported desktop target; these keep the crate compiling there (development
// checks) without pretending to protect anything.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn apply_native_stealth(_window: &WebviewWindow<impl Runtime>, _hud: bool) {}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub fn re_enforce_stealth(_window: &WebviewWindow<impl Runtime>) {}
