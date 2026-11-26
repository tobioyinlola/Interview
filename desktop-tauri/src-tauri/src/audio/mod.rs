//! Audio capture module.
//!
//! Provides system audio capture (loopback) and microphone capture.
//!
//! Platform support:
//!   - Windows: WASAPI loopback for system audio, standard input for mic
//!   - macOS: ScreenCaptureKit for system audio (requires user permission), CoreAudio for mic

pub mod platform;

use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager, Runtime};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Audio device info returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_input: bool,
    pub is_loopback: bool,
}

/// Shared state for audio capture
pub struct AudioState {
    pub capturing: AtomicBool,
}

impl Default for AudioState {
    fn default() -> Self {
        Self {
            capturing: AtomicBool::new(false),
        }
    }
}

/// List available audio devices (mic + loopback)
#[command]
pub async fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    platform::list_devices().map_err(|e| e.to_string())
}

/// Start capturing system audio via WASAPI loopback (Windows) or ScreenCaptureKit (macOS).
/// Audio data is emitted to the frontend as `audio-data` events with PCM chunks.
#[command]
pub async fn start_audio_capture<R: Runtime>(
    app: AppHandle<R>,
    device_id: Option<String>,
) -> Result<(), String> {
    let state = app.state::<AudioState>();
    if state.capturing.swap(true, Ordering::SeqCst) {
        return Err("Audio capture already running".to_string());
    }

    let capturing = Arc::new(AtomicBool::new(true));
    let capturing_clone = capturing.clone();
    let app_clone = app.clone();

    std::thread::spawn(move || {
        if let Err(e) = platform::capture_system_audio(
            device_id.as_deref(),
            capturing_clone,
            move |data: &[f32], sample_rate: u32, channels: u16| {
                // Emit audio data to the frontend as a Tauri event
                let _ = app_clone.emit("audio-data", serde_json::json!({
                    "samples": data,
                    "sampleRate": sample_rate,
                    "channels": channels,
                }));
            },
        ) {
            log::error!("[Audio] Capture error: {}", e);
        }
    });

    Ok(())
}

/// Stop audio capture
#[command]
pub async fn stop_audio_capture<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let state = app.state::<AudioState>();
    state.capturing.store(false, Ordering::SeqCst);
    log::info!("[Audio] Capture stopped");
    Ok(())
}
