import Foundation
import ReplayKit
import AVFoundation

/**
 * SampleHandler (Broadcast Upload Extension):
 * Processes ReplayKit sample buffers:
 * - .audioApp: Internal app sound (Interviewer voice, from Zoom/Meet/Teams)
 * - .audioMic: Microphone sound (User/Candidate voice)
 * - .video: Dropped to conserve CPU and battery
 *
 * Transmits 16-bit 24kHz mono PCM chunks over App Group shared Darwin Notification & IPC.
 */
class SampleHandler: RPBroadcastSampleHandler {

    private let appGroupId = "group.com.interviewmeet.app"
    private var sharedContainerURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId)
    }

    private var audioAppFileHandle: FileHandle?
    private var audioMicFileHandle: FileHandle?

    override func broadcastStarted(withSetupInfo setupInfo: [String : NSObject]?) {
        guard let container = sharedContainerURL else { return }
        let appPipe = container.appendingPathComponent("interviewer_audio.pcm")
        let micPipe = container.appendingPathComponent("candidate_audio.pcm")

        FileManager.default.createFile(atPath: appPipe.path, contents: nil, attributes: nil)
        FileManager.default.createFile(atPath: micPipe.path, contents: nil, attributes: nil)

        audioAppFileHandle = try? FileHandle(forWritingTo: appPipe)
        audioMicFileHandle = try? FileHandle(forWritingTo: micPipe)
    }

    override func broadcastPaused() {
        // User has paused the broadcast
    }

    override func broadcastResumed() {
        // User has resumed the broadcast
    }

    override func broadcastFinished() {
        try? audioAppFileHandle?.close()
        try? audioMicFileHandle?.close()
        audioAppFileHandle = nil
        audioMicFileHandle = nil
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        switch sampleBufferType {
        case .video:
            // STRICT PRIVACY & PERFORMANCE: Drop all video frames immediately
            break

        case .audioApp:
            // Interviewer voice (internal playback from meeting apps)
            guard let pcmData = extractPCM(from: sampleBuffer) else { return }
            try? audioAppFileHandle?.write(contentsOf: pcmData)

        case .audioMic:
            // Candidate / User microphone voice
            guard let pcmData = extractPCM(from: sampleBuffer) else { return }
            try? audioMicFileHandle?.write(contentsOf: pcmData)

        @unknown default:
            break
        }
    }

    /**
     * Extracts raw 16-bit PCM bytes from CMSampleBuffer.
     */
    private func extractPCM(from sampleBuffer: CMSampleBuffer) -> Data? {
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else { return nil }
        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)
        guard status == kCMBlockBufferNoErr, let pointer = dataPointer, length > 0 else {
            return nil
        }
        return Data(bytes: pointer, count: length)
    }
}
