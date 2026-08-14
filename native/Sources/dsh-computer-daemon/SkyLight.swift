import Foundation
import CoreGraphics
import ObjectiveC

/**
 * SkyLight private-API bridge for background input delivery: events posted
 * directly into a target process without activation, focus, or cursor moves.
 *
 * The public `CGEvent.postToPid` skips WindowServer's activity-monitor
 * tickle, so Chromium/Catalyst-family targets drop those events as untrusted;
 * the private `SLEventPostToPid` path (post → tickle → IOHIDPostEvent) is the
 * one those apps accept. On macOS 14+ keyboard events additionally carry an
 * `SLSEventAuthenticationMessage` envelope, built through the private ObjC
 * factory when the runtime provides it.
 *
 * Ported from the MIT-licensed trycua/cua project — Copyright (c) 2025 Cua
 * AI, Inc. (https://github.com/trycua/cua, libs/cua-driver/rust/crates/
 * platform-macos/src/input/skylight.rs) — and used under its license terms.
 *
 * Every symbol resolves lazily through `dlopen` + `dlsym`; when one is absent
 * the callers fall back to the public `CGEvent.postToPid`, so an OS release
 * that removes a symbol degrades to today's behavior instead of crashing.
 */
enum SkyLight {

    // MARK: - Function-pointer signatures

    private typealias PostToPidFn = @convention(c) (pid_t, UnsafeMutableRawPointer) -> Void
    private typealias SetAuthMessageFn = @convention(c) (UnsafeMutableRawPointer, UnsafeMutableRawPointer?) -> Void
    private typealias SetWindowLocationFn = @convention(c) (UnsafeMutableRawPointer, Double, Double) -> Void
    private typealias SetIntegerFieldFn = @convention(c) (UnsafeMutableRawPointer, UInt32, Int64) -> Void
    private typealias ConnectionIdFn = @convention(c) () -> UInt32
    private typealias GetWindowOwnerFn = @convention(c) (UInt32, UInt32, UnsafeMutablePointer<UInt32>) -> Int32
    private typealias GetConnectionPSNFn = @convention(c) (UInt32, UnsafeMutableRawPointer) -> Int32
    private typealias GetFrontProcessFn = @convention(c) (UnsafeMutableRawPointer) -> Int32
    private typealias PostEventRecordToFn = @convention(c) (UnsafeRawPointer, UnsafePointer<UInt8>) -> Int32
    private typealias GetProcessForPIDFn = @convention(c) (pid_t, UnsafeMutableRawPointer) -> Int32
    private typealias ObjcMsgSendFn = @convention(c) (AnyClass, Selector, UnsafeMutableRawPointer?, Int32, UInt32) -> AnyObject?
    private typealias ClassRespondsFn = @convention(c) (AnyClass, Selector) -> Bool
    private typealias SelRegisterFn = @convention(c) (UnsafePointer<CChar>) -> Selector

    // MARK: - Symbol resolution

    /** Load SkyLight once so RTLD_DEFAULT lookups find its exported symbols. */
    private static let skylightLoaded: Void = {
        let path = "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight"
        _ = path.withCString { dlopen($0, RTLD_LAZY | RTLD_GLOBAL) }
    }()

    /** Look up one symbol by name through RTLD_DEFAULT, after loading SkyLight. */
    private static func symbol(_ name: String) -> UnsafeMutableRawPointer? {
        _ = skylightLoaded
        return name.withCString { dlsym(UnsafeMutableRawPointer(bitPattern: -2), $0) }
    }

    /** Reinterpret a resolved symbol pointer as a typed function pointer. */
    private static func fn<T>(_ name: String) -> T? {
        symbol(name).map { unsafeBitCast($0, to: T.self) }
    }

    /** The raw pointer of a CGEvent, for the SPI entry points that take CGEventRef. */
    private static func eventPointer(_ event: CGEvent) -> UnsafeMutableRawPointer {
        Unmanaged.passUnretained(event).toOpaque()
    }

    /**
     * Extract the embedded `SLSEventRecord *` from a CGEvent. The record
     * pointer sits after `{CFRuntimeBase, uint32_t}` at byte offset 24;
     * offsets 32 and 16 are probed for resilience across OS versions.
     */
    private static func extractEventRecord(_ event: CGEvent) -> UnsafeMutableRawPointer? {
        let raw = eventPointer(event)
        for offset in [24, 32, 16] {
            let slot = raw.advanced(by: offset).assumingMemoryBound(to: UInt.self).pointee
            if slot != 0, let record = UnsafeMutableRawPointer(bitPattern: slot) {
                return record
            }
        }
        return nil
    }

    // MARK: - Event posting

    /**
     * Post one event directly into `pid` through the private SkyLight path.
     * @param attachAuth - build and attach the `SLSEventAuthenticationMessage`
     *   envelope (keyboard events on macOS 14+); mouse events pass false.
     * @returns true when `SLEventPostToPid` resolved and was called; false
     *   when the SPI is absent and the caller must use the public postToPid.
     */
    static func postToPid(pid: pid_t, event: CGEvent, attachAuth: Bool) -> Bool {
        guard let post: PostToPidFn = fn("SLEventPostToPid") else { return false }
        if attachAuth,
           let cls = NSClassFromString("SLSEventAuthenticationMessage"),
           let selRegister: SelRegisterFn = fn("sel_registerName"),
           let responds: ClassRespondsFn = fn("class_respondsToSelector"),
           let msgSend: ObjcMsgSendFn = fn("objc_msgSend"),
           let setAuth: SetAuthMessageFn = fn("SLEventSetAuthenticationMessage") {
            // The class exists on macOS 14 but the factory selector arrived on
            // macOS 15; a selector-intern check alone is not enough.
            let selector = selRegister("messageWithEventRecord:pid:version:")
            if responds(cls, selector), let record = extractEventRecord(event) {
                let message = msgSend(cls, selector, record, pid, 0)
                if let message {
                    setAuth(eventPointer(event), Unmanaged.passUnretained(message).toOpaque())
                }
            }
        }
        post(pid, eventPointer(event))
        return true
    }

    /** Stamp a window-local point onto the event (private `CGEventSetWindowLocation`). */
    static func setWindowLocation(_ event: CGEvent, x: Double, y: Double) -> Bool {
        guard let set: SetWindowLocationFn = fn("CGEventSetWindowLocation") else { return false }
        set(eventPointer(event), x, y)
        return true
    }

    /** Stamp a raw SkyLight integer field onto the event (`SLEventSetIntegerValueField`). */
    static func setIntegerField(_ event: CGEvent, field: UInt32, value: Int64) -> Bool {
        guard let set: SetIntegerFieldFn = fn("SLEventSetIntegerValueField") else { return false }
        set(eventPointer(event), field, value)
        return true
    }

    // MARK: - Focus without raise

    /**
     * Build the 248-byte focus/defocus event record posted through
     * `SLPSPostEventRecordTo` (the yabai focus-without-raise recipe).
     * @param windowId - target window id, stamped little-endian at 0x3c–0x3f.
     * @param focus - the 0x8a marker: 0x01 focuses, 0x02 defocuses.
     * @returns the record, every other byte zero.
     */
    static func focusRecord(windowId: UInt32, focus: Bool) -> [UInt8] {
        var buffer = [UInt8](repeating: 0, count: 0xF8)
        buffer[0x04] = 0xF8
        buffer[0x08] = 0x0D
        buffer[0x3C] = UInt8(truncatingIfNeeded: windowId)
        buffer[0x3D] = UInt8(truncatingIfNeeded: windowId >> 8)
        buffer[0x3E] = UInt8(truncatingIfNeeded: windowId >> 16)
        buffer[0x3F] = UInt8(truncatingIfNeeded: windowId >> 24)
        buffer[0x8A] = focus ? 0x01 : 0x02
        return buffer
    }

    /**
     * Make the target app's window the active one without raising any window
     * or following its Space: defocus the current front process, then focus
     * the target. Chromium's user-activation gate stays open because no
     * window is restacked. @returns false when any required SPI is absent.
     */
    static func activateWithoutRaise(pid: pid_t, windowId: UInt32) -> Bool {
        guard windowId != 0,
              let postRecord: PostEventRecordToFn = fn("SLPSPostEventRecordTo"),
              let getFront: GetFrontProcessFn = fn("_SLPSGetFrontProcess")
        else { return false }

        var previousPSN = [UInt8](repeating: 0, count: 8)
        let gotFront = previousPSN.withUnsafeMutableBytes { getFront($0.baseAddress!) }
        guard gotFront == 0 else { return false }

        var targetPSN = [UInt8](repeating: 0, count: 8)
        guard processPSNForWindow(windowId: windowId, pid: pid, into: &targetPSN) else { return false }

        let defocusOK = previousPSN.withUnsafeBytes { previous in
            let record = focusRecord(windowId: windowId, focus: false)
            return record.withUnsafeBufferPointer { postRecord(previous.baseAddress!, $0.baseAddress!) == 0 }
        }
        let focusOK = targetPSN.withUnsafeBytes { target in
            let record = focusRecord(windowId: windowId, focus: true)
            return record.withUnsafeBufferPointer { postRecord(target.baseAddress!, $0.baseAddress!) == 0 }
        }
        return defocusOK && focusOK
    }

    /**
     * Resolve the target process's 8-byte ProcessSerialNumber, preferring the
     * window-owner path (`SLSGetWindowOwner` + `SLSGetConnectionPSN`) with
     * `GetProcessForPID` as the older-system fallback.
     */
    private static func processPSNForWindow(windowId: UInt32, pid: pid_t, into psn: inout [UInt8]) -> Bool {
        if let connection: ConnectionIdFn = fn("CGSMainConnectionID"),
           let getOwner: GetWindowOwnerFn = fn("SLSGetWindowOwner"),
           let getPSN: GetConnectionPSNFn = fn("SLSGetConnectionPSN") {
            var ownerConnection = UInt32(0)
            let gotOwner = getOwner(connection(), windowId, &ownerConnection)
            let gotPSN = psn.withUnsafeMutableBytes { getPSN(ownerConnection, $0.baseAddress!) }
            if gotOwner == 0 && gotPSN == 0 { return true }
        }
        if let getProcess: GetProcessForPIDFn = fn("GetProcessForPID") {
            return psn.withUnsafeMutableBytes { getProcess(pid, $0.baseAddress!) } == 0
        }
        return false
    }
}
