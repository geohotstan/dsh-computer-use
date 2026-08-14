import Foundation
import CoreGraphics

/** The session tap callback: a top-level constant so it forms a C function pointer. */
private let recorderTapCallback: CGEventTapCallBack = { _, type, event, _ in
    Recorder.capture(event: event, type: type)
    return Unmanaged.passUnretained(event)
}

/**
 * Record & Replay recorder: a listen-only session event tap that journals
 * the user's keyboard and mouse activity into a bounded, timestamped event
 * log while a recording is active, capped at 30 minutes (the official
 * bound). One background thread owns the tap and its run loop; the daemon's
 * synchronous main loop drives start/status/stop through shared locked
 * state, and stop (or the cap) writes the journal plus metadata as one JSON
 * file whose path the status reports.
 */
final class Recorder {

    /** One journaled input event: kind, time since recording start, and the fields its kind carries. */
    struct JournalEvent: Codable {
        let kind: String
        let time: Double
        let keyCode: Int64?
        let flags: UInt64
        let point: [Double]?
        let text: String?
    }

    /** The journal file: metadata plus the event list, in one document. */
    private struct JournalFile: Codable {
        struct Metadata: Codable {
            let startedAt: Double
            let stoppedAt: Double
            let maxDurationSec: Double
            let eventCount: Int
        }

        let metadata: Metadata
        let events: [JournalEvent]
    }

    /** The official recording cap. */
    static let maxDurationSec: Double = 30 * 60
    /** Hard bound on journaled events, so a runaway recording cannot exhaust memory. */
    static let maxEvents = 200_000

    private static let lock = NSLock()
    private static var recording = false
    private static var startTime: Double = 0
    private static var events: [JournalEvent] = []
    private static var lastPath: String?
    private static var thread: Thread?
    private static var tap: CFMachPort?

    // MARK: - Control

    /** Start a recording; an active recording returns its live status instead of restarting. */
    static func start() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        if recording { return statusLocked() }
        events = []
        startTime = Date().timeIntervalSince1970
        lastPath = nil
        recording = true
        startTapThread()
        return statusLocked()
    }

    /** Live status, or the most recent finished recording's summary. */
    static func status() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        finalizeIfExpired()
        return statusLocked()
    }

    /** Stop an active recording, write the journal file, and return its summary. */
    static func stop() -> [String: Any] {
        lock.lock()
        defer { lock.unlock() }
        finalize()
        return statusLocked()
    }

    // MARK: - State

    private static func statusLocked() -> [String: Any] {
        var result: [String: Any] = ["recording": recording, "maxDurationSec": maxDurationSec]
        if recording {
            result["startTime"] = startTime
            result["elapsedSec"] = Date().timeIntervalSince1970 - startTime
            result["eventCount"] = events.count
        } else {
            if let path = lastPath { result["path"] = path }
            if startTime > 0 { result["startTime"] = startTime }
        }
        return result
    }

    private static func finalizeIfExpired() {
        if recording && Date().timeIntervalSince1970 - startTime >= maxDurationSec {
            finalize()
        }
    }

    /** Stop the tap thread and write the journal file when a recording was active. */
    private static func finalize() {
        guard recording else { return }
        stopTapThread()
        recording = false
        let stoppedAt = Date().timeIntervalSince1970
        let file = JournalFile(
            metadata: JournalFile.Metadata(
                startedAt: startTime,
                stoppedAt: stoppedAt,
                maxDurationSec: maxDurationSec,
                eventCount: events.count
            ),
            events: events
        )
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(file)
            let name = "dsh-computer-record-\(Int(startTime)).json"
            let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(name)
            try data.write(to: url, options: .atomic)
            lastPath = url.path
        } catch {
            lastPath = nil
        }
        events = []
    }

    // MARK: - Tap thread

    private static func startTapThread() {
        guard thread == nil else { return }
        let worker = Thread(block: runTapLoop)
        worker.name = "dsh-computer-recorder"
        thread = worker
        worker.start()
    }

    /**
     * The tap thread's run loop: install the listen-only event tap, pump the
     * run loop until the thread is cancelled, then tear the tap down.
     * A separate method (not a big trailing closure) keeps this a sequence of
     * small expressions — the single giant closure body exceeds Swift 5.10's
     * expression type-check budget on the CI toolchain.
     */
    private static func runTapLoop() {
        let mask: CGEventMask = CGEventMask(1 << CGEventType.keyDown.rawValue)
            | CGEventMask(1 << CGEventType.keyUp.rawValue)
            | CGEventMask(1 << CGEventType.leftMouseDown.rawValue)
            | CGEventMask(1 << CGEventType.leftMouseUp.rawValue)
            | CGEventMask(1 << CGEventType.rightMouseDown.rawValue)
            | CGEventMask(1 << CGEventType.rightMouseUp.rawValue)
            | CGEventMask(1 << CGEventType.scrollWheel.rawValue)
            | CGEventMask(1 << CGEventType.mouseMoved.rawValue)
        let callback = recorderTapCallback
        guard let created = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: callback,
            userInfo: nil
        ) else { return }
        tap = created
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
        CGEvent.tapEnable(tap: created, enable: true)
        while !Thread.current.isCancelled {
            CFRunLoopRunInMode(.defaultMode, 0.1, false)
        }
        CGEvent.tapEnable(tap: created, enable: false)
        CFMachPortInvalidate(created)
    }

    private static func stopTapThread() {
        thread?.cancel()
        thread = nil
        tap = nil
    }

    // MARK: - Event journaling

    /** Encode one captured event into the journal; the cap stops the recording in place. */
    static func capture(event: CGEvent, type: CGEventType) {
        lock.lock()
        defer { lock.unlock() }
        guard recording else { return }
        if Date().timeIntervalSince1970 - startTime >= maxDurationSec {
            finalize()
            return
        }
        guard events.count < maxEvents else {
            finalize()
            return
        }
        let elapsed = Date().timeIntervalSince1970 - startTime
        guard let summary = summarize(event: event, type: type, time: elapsed) else { return }
        events.append(summary)
    }

    /**
     * The pure event summarization: kind, keycode/flags/unicode for keys,
     * location for mouse events, and both wheel deltas for scrolls. Nil for
     * events the journal does not carry.
     */
    static func summarize(event: CGEvent, type: CGEventType, time: Double = 0) -> JournalEvent? {
        let kind: String?
        switch type {
        case .keyDown: kind = "keyDown"
        case .keyUp: kind = "keyUp"
        case .leftMouseDown: kind = "leftMouseDown"
        case .leftMouseUp: kind = "leftMouseUp"
        case .rightMouseDown: kind = "rightMouseDown"
        case .rightMouseUp: kind = "rightMouseUp"
        case .scrollWheel: kind = "scrollWheel"
        case .mouseMoved: kind = "mouseMoved"
        default: kind = nil
        }
        guard let kind else { return nil }

        var keyCode: Int64?
        var text: String?
        if kind == "keyDown" || kind == "keyUp" {
            let code = Int64(event.getIntegerValueField(.keyboardEventKeycode))
            keyCode = code
            if code == 0 {
                // Virtual-key 0 events carry a unicode string; read it best-effort.
                var length = 8
                var buffer = [UniChar](repeating: 0, count: 8)
                event.keyboardGetUnicodeString(maxStringLength: 8, actualStringLength: &length, unicodeString: &buffer)
                if length > 0 {
                    text = String(utf16CodeUnits: buffer, count: length)
                }
            }
        }
        var point: [Double]?
        let mouseKinds: Set<String> = ["leftMouseDown", "leftMouseUp", "rightMouseDown", "rightMouseUp", "mouseMoved", "scrollWheel"]
        if mouseKinds.contains(kind) {
            point = [Double(event.location.x), Double(event.location.y)]
        }
        return JournalEvent(
            kind: kind,
            time: time,
            keyCode: keyCode,
            flags: event.flags.rawValue,
            point: point,
            text: text
        )
    }
}
