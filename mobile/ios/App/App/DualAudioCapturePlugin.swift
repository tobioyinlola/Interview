import Foundation
import Capacitor
import ReplayKit
import AVFoundation

/**
 * DualAudioCapturePlugin (iOS Capacitor Plugin):
 * Interacts with ReplayKit Broadcast Extension and AVAudioSession.
 * Routes interviewer audio (.audioApp -> speaker: "partner") and candidate audio (.audioMic -> speaker: "you").
 */
@objc(DualAudioCapturePlugin)
public class DualAudioCapturePlugin: CAPPlugin {
    private let appGroupId = "group.com.interviewmeet.app"
    private var isCapturing = false
    private var pollTimer: Timer?
    private var broadcastPicker: RPSystemBroadcastPickerView?

    @objc func checkSupport(_ call: CAPPluginCall) {
        call.resolve([
            "supported": true,
            "platform": "ios"
        ])
    }

    /**
     * Triggers the iOS system screen broadcast picker.
     */
    @objc func requestCapture(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let picker = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
            picker.preferredExtension = "com.interviewmeet.app.BroadcastExtension"
            picker.showsMicrophoneButton = true
            self.broadcastPicker = picker

            // Find the subview button and trigger it
            for view in picker.subviews {
                if let button = view as? UIButton {
                    button.sendActions(for: .allTouchEvents)
                    break
                }
            }

            call.resolve([
                "granted": true
            ])
        }
    }

    /**
     * Starts listening to audio streams from the Broadcast Extension.
     */
    @objc func startCapture(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "dual"
        let sampleRate = call.getInt("sampleRate") ?? 24000

        isCapturing = true

        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            // Fallback if app groups are not configured:
            call.resolve([
                "started": true,
                "mode": mode,
                "sampleRate": sampleRate,
                "fallback": true
            ])
            return
        }

        let appPipe = container.appendingPathComponent("interviewer_audio.pcm")
        let micPipe = container.appendingPathComponent("candidate_audio.pcm")

        // Start polling files
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            var appOffset: UInt64 = 0
            var micOffset: UInt64 = 0

            while self.isCapturing {
                if mode == "dual" || mode == "device" {
                    if let handle = try? FileHandle(forReadingFrom: appPipe) {
                        handle.seek(toFileOffset: appOffset)
                        let data = handle.readData(ofLength: 2048)
                        if !data.isEmpty {
                            appOffset += UInt64(data.count)
                            self.notifyListeners("audioFrame", data: [
                                "speaker": "partner",
                                "data": data.base64EncodedString()
                            ])
                        }
                        try? handle.close()
                    }
                }

                if mode == "dual" || mode == "mic" {
                    if let handle = try? FileHandle(forReadingFrom: micPipe) {
                        handle.seek(toFileOffset: micOffset)
                        let data = handle.readData(ofLength: 2048)
                        if !data.isEmpty {
                            micOffset += UInt64(data.count)
                            let speaker = (mode == "mic") ? "partner" : "you"
                            self.notifyListeners("audioFrame", data: [
                                "speaker": speaker,
                                "data": data.base64EncodedString()
                            ])
                        }
                        try? handle.close()
                    }
                }

                Thread.sleep(forTimeInterval: 0.04) // ~25-40ms chunks
            }
        }

        call.resolve([
            "started": true,
            "mode": mode,
            "sampleRate": sampleRate
        ])
    }

    @objc func stopCapture(_ call: CAPPluginCall) {
        isCapturing = false
        call.resolve([
            "stopped": true
        ])
    }
}
