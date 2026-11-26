//! Platform-specific audio capture implementations.

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;

use super::AudioDevice;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// List available audio devices on the current platform.
pub fn list_devices() -> Result<Vec<AudioDevice>, Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    return windows::list_devices();

    #[cfg(target_os = "macos")]
    return macos::list_devices();

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("Audio capture not supported on this platform".into())
}

/// Capture system audio (loopback).
/// Calls `callback` with PCM float samples, sample rate, and channel count.
/// Runs until `running` is set to false.
pub fn capture_system_audio<F>(
    device_id: Option<&str>,
    running: Arc<AtomicBool>,
    callback: F,
) -> Result<(), Box<dyn std::error::Error>>
where
    F: Fn(&[f32], u32, u16) + Send + 'static,
{
    #[cfg(target_os = "windows")]
    return windows::capture_loopback(device_id, running, callback);

    #[cfg(target_os = "macos")]
    return macos::capture_system_audio(device_id, running, callback);

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    Err("Audio capture not supported on this platform".into())
}
