import Foundation
import AppKit
import CoreGraphics
import CoreImage
import ImageIO
import ScreenCaptureKit

/**
 * Single-frame window screenshot via ScreenCaptureKit: one SCStream over the
 * retained window id, one captured frame, JPEG-compressed toward the daemon's
 * byte target, then the stream stops. A brief border highlight marks the
 * capture region before the frame is taken, the Codex "CaptureAnimation"
 * gesture. The main loop is synchronous, so the async shareable-content
 * lookup and the frame callback both release a semaphore instead of awaiting.
 */
enum Screenshot {

    /** JPEG byte target per capture; the engine still enforces its own configured bound. */
    static let targetBytes = 512 * 1024

    /** Capture the given window and encode it as a JPEG payload. */
    static func capture(windowId: CGWindowID) throws -> [String: Any] {
        guard windowId != 0 else { throw DaemonError.captureFailed("window id unavailable") }
        guard let shareable = awaitShareableContent() else {
            throw DaemonError.captureFailed("could not enumerate shareable content")
        }
        guard let window = shareable.windows.first(where: { $0.windowID == windowId }) else {
            throw DaemonError.captureFailed("window \(windowId) is not on screen")
        }
        // The window frame is in screen coordinates (bottom-left origin); the
        // highlight overlay needs the same space.
        let frame = window.frame
        let overlay = CaptureOverlay.show(frame: frame)
        Thread.sleep(forTimeInterval: 0.12)

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let configuration = SCStreamConfiguration()
        configuration.width = Int(max(1, frame.width.rounded()))
        configuration.height = Int(max(1, frame.height.rounded()))
        configuration.queueDepth = 1
        configuration.showsCursor = true
        configuration.capturesAudio = false

        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        let semaphore = DispatchSemaphore(value: 0)
        let box = LockedBox<CGImage?>(nil)
        let failure = LockedBox<Error?>(nil)
        let output = ScreenshotOutput(
            onFrame: { image in
                box.value = image
                semaphore.signal()
            },
            onFailure: { error in
                failure.value = error
                semaphore.signal()
            }
        )
        do {
            try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "dsh-computer-screenshot"))
            stream.startCapture()
            _ = semaphore.wait(timeout: .now() + 10)
            stream.stopCapture()
        } catch {
            overlay?.close()
            throw DaemonError.captureFailed("screen capture failed: \(error)")
        }
        overlay?.close()
        guard let image = box.value else {
            throw DaemonError.captureFailed("no frame captured: \(failure.value?.localizedDescription ?? "timeout")")
        }
        let data = jpegData(image: image)
        return [
            "dataBase64": data.base64EncodedString(),
            "width": image.width,
            "height": image.height,
        ]
    }

    // MARK: - Async bridging

    private static func awaitShareableContent() -> SCShareableContent? {
        let semaphore = DispatchSemaphore(value: 0)
        var content: SCShareableContent?
        Task {
            content = try? await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 10)
        return content
    }

    // MARK: - JPEG encoding

    /** Encode toward the byte target, stepping quality down while the result still exceeds it. */
    private static func jpegData(image: CGImage) -> Data {
        var best: Data = Data()
        for quality in [0.6, 0.45, 0.3, 0.15] {
            let data = NSMutableData()
            guard let destination = CGImageDestinationCreateWithData(data, "public.jpeg" as CFString, 1, nil) else { continue }
            let properties = [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary
            CGImageDestinationAddImage(destination, image, properties)
            guard CGImageDestinationFinalize(destination) else { continue }
            best = data as Data
            if best.count <= targetBytes { return best }
        }
        return best
    }
}

/** The SCStream output callback: converts one frame to a CGImage and reports it. */
final class ScreenshotOutput: NSObject, SCStreamOutput {
    private let onFrame: (CGImage) -> Void
    private let onFailure: (Error) -> Void
    private let context = CIContext()

    init(onFrame: @escaping (CGImage) -> Void, onFailure: @escaping (Error) -> Void) {
        self.onFrame = onFrame
        self.onFailure = onFailure
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
        else {
            onFailure(DaemonError.captureFailed("unexpected capture output type"))
            return
        }
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = context.createCGImage(image, from: image.extent) else {
            onFailure(DaemonError.captureFailed("frame conversion failed"))
            return
        }
        onFrame(cgImage)
    }
}

/** A borderless, click-transparent highlight around the capture region. */
enum CaptureOverlay {
    static func show(frame: CGRect) -> NSWindow? {
        let window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.level = .screenSaver
        window.ignoresMouseEvents = true
        window.hasShadow = false
        let view = NSView(frame: NSRect(origin: .zero, size: frame.size))
        view.wantsLayer = true
        view.layer?.borderWidth = 3
        view.layer?.borderColor = NSColor.systemBlue.cgColor
        view.layer?.cornerRadius = 8
        view.layer?.backgroundColor = NSColor.systemBlue.withAlphaComponent(0.08).cgColor
        window.contentView = view
        window.orderFrontRegardless()
        return window
    }
}

/** A tiny lock-guarded box so capture callbacks can publish one value safely. */
final class LockedBox<Value> {
    private let lock = NSLock()
    private var stored: Value

    init(_ value: Value) {
        self.stored = value
    }

    var value: Value {
        get {
            lock.lock()
            defer { lock.unlock() }
            return stored
        }
        set {
            lock.lock()
            stored = newValue
            lock.unlock()
        }
    }
}
