package com.interviewmeet.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * DualAudioCapturePlugin:
 * Enables dual-stream audio capture on Android 10+ (API 29+).
 * Stream 1: Device/Internal Audio via MediaProjection + AudioPlaybackCapture (Interviewer / speaker: "partner")
 * Stream 2: Microphone Audio via AudioRecord VOICE_RECOGNITION (Candidate / speaker: "you")
 */
@CapacitorPlugin(name = "DualAudioCapture")
public class DualAudioCapturePlugin extends Plugin {
    private static final String TAG = "DualAudioCapture";
    private static final int FRAME_SIZE = 1024; // 1024 samples per chunk

    private int projectionResultCode = Activity.RESULT_CANCELED;
    private Intent projectionData = null;

    private MediaProjection mediaProjection = null;
    private AudioRecord playbackRecord = null;
    private AudioRecord micRecord = null;

    private Thread playbackThread = null;
    private Thread micThread = null;
    private final AtomicBoolean isCapturing = new AtomicBoolean(false);

    /**
     * Checks if the device supports internal playback capture (Android 10+ / API 29+).
     */
    @PluginMethod
    public void checkSupport(PluginCall call) {
        JSObject ret = new JSObject();
        boolean supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
        ret.put("supported", supported);
        ret.put("minSdk", 29);
        ret.put("currentSdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /**
     * Requests the MediaProjection screen capture permission required for AudioPlaybackCapture.
     * System prompt will display asking permission to record or cast.
     */
    @PluginMethod
    public void requestCapture(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            ret.put("reason", "Device playback capture requires Android 10 or newer");
            call.resolve(ret);
            return;
        }

        MediaProjectionManager mpm = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (mpm == null) {
            call.reject("MediaProjectionManager service unavailable");
            return;
        }

        Intent intent = mpm.createScreenCaptureIntent();
        startActivityForResult(call, intent, "handleProjectionResult");
    }

    @ActivityCallback
    private void handleProjectionResult(PluginCall call, ActivityResult result) {
        if (result == null) {
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
            return;
        }

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            this.projectionResultCode = result.getResultCode();
            this.projectionData = result.getData();
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        } else {
            this.projectionResultCode = Activity.RESULT_CANCELED;
            this.projectionData = null;
            JSObject ret = new JSObject();
            ret.put("granted", false);
            call.resolve(ret);
        }
    }

    /**
     * Starts audio capture in the chosen mode:
     * - "dual": Captures device playback (interviewer) + microphone (candidate)
     * - "device": Captures device playback only (interviewer)
     * - "mic": Captures microphone only
     */
    @PluginMethod
    public void startCapture(PluginCall call) {
        if (isCapturing.get()) {
            call.resolve(new JSObject().put("started", true));
            return;
        }

        String mode = call.getString("mode", "dual");
        int sampleRate = call.getInt("sampleRate", 24000);

        boolean needPlayback = "dual".equals(mode) || "device".equals(mode);
        boolean needMic = "dual".equals(mode) || "mic".equals(mode);

        if (needPlayback) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                call.reject("Device playback capture requires Android 10 or higher");
                return;
            }
            if (projectionData == null || projectionResultCode != Activity.RESULT_OK) {
                call.reject("MediaProjection permission not granted. Call requestCapture() first.");
                return;
            }
        }

        try {
            // Start foreground service for Android 14+ background/projection compliance
            AudioCaptureService.start(getContext());

            if (needPlayback && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaProjectionManager mpm = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
                if (mpm != null) {
                    this.mediaProjection = mpm.getMediaProjection(projectionResultCode, (Intent) projectionData.clone());
                }

                if (this.mediaProjection == null) {
                    AudioCaptureService.stop(getContext());
                    call.reject("Failed to obtain MediaProjection instance");
                    return;
                }

                AudioPlaybackCaptureConfiguration playbackConfig = new AudioPlaybackCaptureConfiguration.Builder(this.mediaProjection)
                        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                        .addMatchingUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .addMatchingUsage(AudioAttributes.USAGE_GAME)
                        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                        .build();

                AudioFormat playbackFormat = new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                        .build();

                int minBuf = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                int bufSize = Math.max(minBuf * 2, FRAME_SIZE * 4);

                this.playbackRecord = new AudioRecord.Builder()
                        .setAudioPlaybackCaptureConfig(playbackConfig)
                        .setAudioFormat(playbackFormat)
                        .setBufferSizeInBytes(bufSize)
                        .build();
            }

            if (needMic) {
                int minBuf = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                int bufSize = Math.max(minBuf * 2, FRAME_SIZE * 4);

                this.micRecord = new AudioRecord(
                        MediaRecorder.AudioSource.VOICE_RECOGNITION,
                        sampleRate,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        bufSize
                );
            }

            isCapturing.set(true);

            if (playbackRecord != null) {
                playbackRecord.startRecording();
                playbackThread = new Thread(() -> runCaptureLoop(playbackRecord, "partner", true), "IM-PlaybackAudio");
                playbackThread.start();
            }

            if (micRecord != null) {
                micRecord.startRecording();
                String micSpeaker = "mic".equals(mode) ? "partner" : "you";
                micThread = new Thread(() -> runCaptureLoop(micRecord, micSpeaker, false), "IM-MicAudio");
                micThread.start();
            }

            JSObject res = new JSObject();
            res.put("started", true);
            res.put("mode", mode);
            res.put("sampleRate", sampleRate);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Error starting capture: " + e.getMessage(), e);
            stopInternal();
            call.reject("Failed to start audio capture: " + e.getMessage());
        }
    }

    /**
     * Capture worker loop. Reads 1024-sample chunks, encodes to base64, and notifies listeners.
     */
    private void runCaptureLoop(AudioRecord recorder, String speaker, boolean isPlayback) {
        short[] shortBuffer = new short[FRAME_SIZE];
        byte[] byteBuffer = new byte[FRAME_SIZE * 2];
        long silentSamples = 0;
        boolean silenceWarned = false;

        while (isCapturing.get() && recorder.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
            int read = recorder.read(shortBuffer, 0, FRAME_SIZE);
            if (read <= 0) {
                continue;
            }

            long sumSquares = 0;
            for (int i = 0; i < read; i++) {
                short sample = shortBuffer[i];
                sumSquares += (long) sample * sample;
            }
            double rms = Math.sqrt((double) sumSquares / read);

            if (isPlayback) {
                if (rms < 5.0) {
                    silentSamples += read;
                    // ~10 seconds of 24000 Hz audio = 240,000 samples
                    if (silentSamples > 240000 && !silenceWarned) {
                        silenceWarned = true;
                        JSObject warn = new JSObject();
                        warn.put("code", "device_audio_silent");
                        warn.put("message", "Device audio is silent. If your call app blocks capture or you're on a regular phone call, switch to Speakerphone.");
                        notifyListeners("audioWarning", warn);
                    }
                } else {
                    silentSamples = 0;
                    silenceWarned = false;
                }
            }

            // Convert shorts to little-endian bytes
            ByteBuffer.wrap(byteBuffer).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(shortBuffer, 0, read);

            String base64Data = Base64.encodeToString(byteBuffer, 0, read * 2, Base64.NO_WRAP);
            JSObject event = new JSObject();
            event.put("speaker", speaker);
            event.put("data", base64Data);
            notifyListeners("audioFrame", event);
        }
    }

    /**
     * Stops audio capture and releases all native resources.
     */
    @PluginMethod
    public void stopCapture(PluginCall call) {
        stopInternal();
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    private void stopInternal() {
        isCapturing.set(false);

        if (playbackThread != null) {
            try {
                playbackThread.join(500);
            } catch (InterruptedException ignored) {}
            playbackThread = null;
        }

        if (micThread != null) {
            try {
                micThread.join(500);
            } catch (InterruptedException ignored) {}
            micThread = null;
        }

        if (playbackRecord != null) {
            try {
                if (playbackRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    playbackRecord.stop();
                }
                playbackRecord.release();
            } catch (Exception ignored) {}
            playbackRecord = null;
        }

        if (micRecord != null) {
            try {
                if (micRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    micRecord.stop();
                }
                micRecord.release();
            } catch (Exception ignored) {}
            micRecord = null;
        }

        if (mediaProjection != null) {
            try {
                mediaProjection.stop();
            } catch (Exception ignored) {}
            mediaProjection = null;
        }

        AudioCaptureService.stop(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        super.handleOnDestroy();
    }
}
