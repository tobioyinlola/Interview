//! macOS audio capture via ScreenCaptureKit (system audio) and CoreAudio (mic).
//!
//! ScreenCaptureKit requires macOS 13+ and user permission.
//! For the initial build, mic capture uses cpal (CoreAudio).
//! System audio capture via ScreenCaptureKit is a TODO that requires
//! the `screencapturekit-rs` crate or manual objc bindings.
//!
//! For now, macOS uses getDisplayMedia in the WebView2 (Safari/WebKit) for system audio,
//! which shows a one-time system picker. This is acceptable because:
//!   - macOS always requires user consent for screen/audio capture
//!   - The permission is remembered per-app after the first grant

use super::super::AudioDevice;
use cpal::traits::{DeviceTrait, HostTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// List available audio input devices on macOS.
pub fn list_devices() -> Result<Vec<AudioDevice>, Box<dyn std::error::Error>> {
    // On macOS, we list CoreAudio input devices via cpal.
    // System audio capture is handled separately via ScreenCaptureKit.
    let host = cpal::default_host();
    let mut devices = Vec::new();

    for device in host.input_devices()? {
        let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
        devices.push(AudioDevice {
            id: name.clone(),
            name,
            is_input: true,
            is_loopback: false,
        });
    }

    // Add a virtual "System Audio" device that represents ScreenCaptureKit capture
    devices.push(AudioDevice {
        id: "screencapturekit".to_string(),
        name: "System Audio (ScreenCaptureKit)".to_string(),
        is_input: false,
        is_loopback: true,
    });

    Ok(devices)
}

/// Capture system audio on macOS.
///
/// TODO: Implement native ScreenCaptureKit capture for silent system audio.
/// For now, the frontend uses WebView's getDisplayMedia() with audio:true,
/// which works on macOS via Safari/WebKit in the Tauri WebView.
pub fn capture_system_audio<F>(
    _device_id: Option<&str>,
    running: Arc<AtomicBool>,
    callback: F,
) -> Result<(), Box<dyn std::error::Error>>
where
    F: Fn(&[f32], u32, u16) + Send + 'static,
{
    log::info!("[Audio] macOS: ScreenCaptureKit capture not yet implemented natively");
    log::info!("[Audio] macOS: Using WebView getDisplayMedia() for system audio");

    // Keep thread alive until stopped (the actual capture runs in the WebView)
    while running.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    Ok(())
}
