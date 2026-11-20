#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use tauri::{Manager, Window};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongW, SetWindowLongW, SetWindowDisplayAffinity,
    GWL_EXSTYLE, WS_EX_TRANSPARENT, WS_EX_LAYERED, WDA_EXCLUDEFROMCAPTURE
};

#[tauri::command]
fn set_click_through(window: Window, ignore: bool) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd_obj) = window.hwnd() {
            let hwnd_id = hwnd_obj.0 as isize;
            let hwnd = HWND(hwnd_id);

            unsafe {
                let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                
                let new_style = if ignore {
                    ex_style | WS_EX_TRANSPARENT.0 as i32 | WS_EX_LAYERED.0 as i32
                } else {
                    ex_style & !(WS_EX_TRANSPARENT.0 as i32) & !(WS_EX_LAYERED.0 as i32)
                };
                
                SetWindowLongW(hwnd, GWL_EXSTYLE, new_style);
            }
        }
    }
}

#[tauri::command]
fn close_app(window: Window) {
    let _ = window.close();
}

#[tauri::command]
fn minimize_app(window: Window) {
    let _ = window.minimize();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_click_through, close_app, minimize_app])
        .setup(|app| {
            if let Some(window) = app.get_window("main") {
                #[cfg(target_os = "windows")]
                {
                    if let Ok(hwnd_obj) = window.hwnd() {
                        let hwnd_id = hwnd_obj.0 as isize;
                        let hwnd = HWND(hwnd_id);

                        unsafe {
                            let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
                        }
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
