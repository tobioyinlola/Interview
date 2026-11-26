//! Windows WASAPI loopback audio capture.
//!
//! Captures the system audio output (what the user hears) via WASAPI loopback mode.
//! This is equivalent to Electron's `desktopCapturer.getSources()` + `audio: "loopback"`
//! but without requiring a screen picker dialog.
//!
//! The captured audio is the full system mix: interviewer's voice from Meet/Zoom/Teams,
//! any other system sounds, etc.

use super::super::AudioDevice;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// List available audio input devices + loopback devices.
pub fn list_devices() -> Result<Vec<AudioDevice>, Box<dyn std::error::Error>> {
    let host = cpal::default_host();
    let mut devices = Vec::new();

    // Input (microphone) devices
    for device in host.input_devices()? {
        let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
        devices.push(AudioDevice {
            id: name.clone(),
            name,
            is_input: true,
            is_loopback: false,
        });
    }

    // Output devices (available as loopback sources on Windows WASAPI)
    for device in host.output_devices()? {
        let name = device.name().unwrap_or_else(|_| "Unknown".to_string());
        devices.push(AudioDevice {
            id: format!("loopback:{}", name),
            name: format!("{} (System Audio)", name),
            is_input: false,
            is_loopback: true,
        });
    }

    Ok(devices)
}

/// Capture system audio via WASAPI loopback.
///
/// Opens the default output device in loopback mode and reads the audio stream
/// that is being played by the system. This captures everything the user hears:
/// meeting audio (Zoom, Teams, Meet), media playback, notifications, etc.
///
/// The callback receives interleaved f32 PCM samples.
pub fn capture_loopback<F>(
    device_id: Option<&str>,
    running: Arc<AtomicBool>,
    callback: F,
) -> Result<(), Box<dyn std::error::Error>>
where
    F: Fn(&[f32], u32, u16) + Send + 'static,
{
    let host = cpal::default_host();

    // Find the device — if a specific one is requested, look it up; otherwise use default output
    let device = if let Some(id) = device_id {
        let name = id.strip_prefix("loopback:").unwrap_or(id);
        host.output_devices()?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
            .ok_or_else(|| format!("Audio device not found: {}", name))?
    } else {
        host.default_output_device()
            .ok_or("No default output device found")?
    };

    let device_name = device.name().unwrap_or_else(|_| "Unknown".to_string());
    log::info!(
        "[Audio] Starting WASAPI loopback capture on: {}",
        device_name
    );

    // Get the default output config — this is what the loopback stream will use
    let config = device.default_output_config()?;
    let sample_rate = config.sample_rate().0;
    let channels = config.channels();

    log::info!(
        "[Audio] Loopback config: {}Hz, {} channels, {:?}",
        sample_rate, channels, config.sample_format()
    );

    // Build input stream in loopback mode.
    // cpal on Windows WASAPI supports opening an output device as an input (loopback).
    let stream = device.build_input_stream(
        &config.into(),
        move |data: &[f32], _: &cpal::InputCallbackInfo| {
            callback(data, sample_rate, channels);
        },
        |err| {
            log::error!("[Audio] Loopback stream error: {}", err);
        },
        None, // No timeout
    )?;

    stream.play()?;
    log::info!("[Audio] WASAPI loopback capture started");

    // Keep the stream alive until stopped
    while running.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    drop(stream);
    log::info!("[Audio] WASAPI loopback capture stopped");
    Ok(())
}
