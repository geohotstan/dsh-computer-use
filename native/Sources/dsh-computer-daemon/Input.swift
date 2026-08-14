import Foundation
import AppKit
import ApplicationServices
import CoreGraphics
import IOKit.pwr_mgt

/**
 * Input synthesis, background-first (the Codex execution model): every action
 * resolves the app's retained capture session (element indexes and
 * window-relative coordinates address the latest `get_app_state`), holds a
 * no-idle-sleep assertion, and delivers the input without taking over the
 * desktop. Semantic operations go through the element's own AX actions
 * (`AXPress`, page scrolls, value/selection writes) and need no focus at all;
 * raw mouse/keyboard events are posted directly into the target app's process
 * through the SkyLight private path (`SLEventPostToPid`, with the keyboard
 * authentication envelope and window-routing field stamps), falling back to
 * the public `CGEvent.postToPid` per symbol — no activation, no raise, and
 * the real cursor never moves. Coordinate clicks additionally prep the
 * target window with the focus-without-raise record post and Chromium's
 * off-screen primer click.
 *
 * The full foreground path (raise + activate + global event tap, no restore)
 * survives only for apps the deployment pins through `DSH_COMPUTER_FOREGROUND_APPS`
 * — it is never entered automatically.
 */
enum InputEngine {

    // MARK: - Foreground override state

    /** Canonical app ids the deployment pins to foreground input (`DSH_COMPUTER_FOREGROUND_APPS`, comma-separated). */
    static var foregroundApps: Set<String> = []

    /** Seed the configured foreground set from the daemon's environment. */
    static func configureForegroundApps(_ environment: [String: String]) {
        let raw = environment["DSH_COMPUTER_FOREGROUND_APPS"] ?? ""
        foregroundApps = Set(
            raw.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
        )
    }

    /** Text-injection strategies: per-scalar unicode key events, or the pasteboard with a synthesized paste. */
    enum TextStrategy {
        case unicodeEvent
        case pasteboard
    }

    /** The official `click_method` vocabulary: which delivery path a click takes. */
    enum ClickMethod: String {
        case auto
        case accessibility
        case appPost = "app_post"
        case skyClick = "sky_click"
        case global

        /** Parse the wire value; the official default is `auto`. */
        static func parse(_ raw: String?) -> ClickMethod {
            guard let raw, let method = ClickMethod(rawValue: raw) else { return .auto }
            return method
        }
    }

    // MARK: - Wire entry points

    static func click(
        session: CaptureSession,
        app: String,
        elementIndex: Int?,
        x: Double?,
        y: Double?,
        clickCount: Int?,
        mouseButton: String?,
        clickMethod: String?
    ) throws {
        let window = try session.capturedWindow(app: app)
        holdIdleAssertion()
        let appId = canonicalId(of: window, fallback: app)
        let method = ClickMethod.parse(clickMethod)
        if let elementIndex {
            let element = try session.element(app: app, index: elementIndex)
            // Background-first: the element's own AX press needs no focus at all.
            if method == .auto || method == .accessibility {
                if !requiresForeground(appId), axPerform(element, action: kAXPressAction) { return }
                // AX invalidation refetch: the element may have gone stale
                // mid-turn; re-walk the tree and retry the press once.
                if !requiresForeground(appId),
                   let fresh = session.refreshElement(app: app, index: elementIndex),
                   axPerform(fresh, action: kAXPressAction) { return }
                if method == .accessibility {
                    throw DaemonError.captureFailed("element \(elementIndex) has no accessible press action")
                }
            }
            guard let point = axClickPoint(element) else {
                throw DaemonError.captureFailed("element \(elementIndex) has no clickable position")
            }
            try postClick(at: point, count: max(1, clickCount ?? 1), button: mouseButton ?? "left", window: window, appId: appId, method: method)
        } else if let x, let y {
            if method == .accessibility {
                throw DaemonError.captureFailed("accessibility click requires element_index")
            }
            let point = try windowPoint(window: window, x: x, y: y)
            try postClick(at: point, count: max(1, clickCount ?? 1), button: mouseButton ?? "left", window: window, appId: appId, method: method)
        } else {
            throw DaemonError.captureFailed("click requires elementIndex or both x and y")
        }
    }

    static func typeText(session: CaptureSession, app: String, text: String) throws {
        let window = try session.capturedWindow(app: app)
        holdIdleAssertion()
        let appId = canonicalId(of: window, fallback: app)
        let running = NSRunningApplication(processIdentifier: window.pid)
        let strategy = textStrategy(
            appName: running?.localizedName ?? "",
            bundleId: running?.bundleIdentifier,
            text: text
        )
        switch strategy {
        case .unicodeEvent:
            try withRawEventDelivery(window: window, appId: appId) { delivery in
                try postUnicodeText(text, delivery: delivery)
            }
        case .pasteboard:
            try withPasteboardPaste(text, window: window, appId: appId)
        }
    }

    static func pressKey(session: CaptureSession, app: String, key: String) throws -> String {
        let window = try session.capturedWindow(app: app)
        holdIdleAssertion()
        let appId = canonicalId(of: window, fallback: app)
        let chord = try KeyChord.parse(key)
        try withRawEventDelivery(window: window, appId: appId) { delivery in
            try postChord(chord, delivery: delivery)
        }
        return axSelectedText(pid: window.pid) ?? ""
    }

    static func scroll(
        session: CaptureSession,
        app: String,
        elementIndex: Int,
        direction: String,
        pages: Double?
    ) throws {
        let window = try session.capturedWindow(app: app)
        let element = try session.element(app: app, index: elementIndex)
        holdIdleAssertion()
        let appId = canonicalId(of: window, fallback: app)
        let count = pages ?? 1
        // The element's own page action scrolls exactly one page and keeps the
        // target's semantics, without focus; walk the AX parent chain for the
        // action before falling back to the wheel.
        let action: String
        switch direction {
        case "up": action = "AXScrollUpByPage"
        case "down": action = "AXScrollDownByPage"
        case "left": action = "AXScrollLeftByPage"
        case "right": action = "AXScrollRightByPage"
        default: throw DaemonError.captureFailed("invalid scroll direction \(direction)")
        }
        let wholePages = count.rounded(.down) == count && count >= 1 && count <= 5
        if wholePages {
            if axPerformPageScroll(from: element, action: action, count: Int(count)) { return }
            if let fresh = session.refreshElement(app: app, index: elementIndex),
               axPerformPageScroll(from: fresh, action: action, count: Int(count)) { return }
            // The AX canary failed: this app rejects the page action, so the
            // wheel fallback below still delivers in the background.
        }
        guard let point = axClickPoint(element) else {
            throw DaemonError.captureFailed("element \(elementIndex) has no scroll position")
        }
        let frame = axFrame(window.element)
        let local = frame.map { CGPoint(x: point.x - $0.origin.x, y: point.y - $0.origin.y) }
        try withRawEventDelivery(window: window, appId: appId) { delivery in
            try postScroll(at: point, window: window, windowLocal: local, direction: direction, pages: count, delivery: delivery)
        }
    }

    static func setValue(session: CaptureSession, app: String, elementIndex: Int, value: String) throws {
        _ = try session.capturedWindow(app: app)
        let element = try session.element(app: app, index: elementIndex)
        holdIdleAssertion()
        var error = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
        if error != .success, let fresh = session.refreshElement(app: app, index: elementIndex) {
            error = AXUIElementSetAttributeValue(fresh, kAXValueAttribute as CFString, value as CFTypeRef)
        }
        guard error == .success else {
            throw DaemonError.captureFailed("set_value on element \(elementIndex) failed with \(error.rawValue)")
        }
    }

    static func selectText(
        session: CaptureSession,
        app: String,
        elementIndex: Int,
        text: String,
        prefix: String?,
        suffix: String?,
        selectionType: String?
    ) throws {
        _ = try session.capturedWindow(app: app)
        let element = try session.element(app: app, index: elementIndex)
        holdIdleAssertion()
        guard let current = axValue(element, kAXValueAttribute) as? String else {
            throw DaemonError.captureFailed("element \(elementIndex) has no text value to select in")
        }
        let range = try matchRange(in: current, text: text, prefix: prefix, suffix: suffix, selectionType: selectionType, elementIndex: elementIndex)
        var error = AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, range)
        if error != .success, let fresh = session.refreshElement(app: app, index: elementIndex),
           let freshCurrent = axValue(fresh, kAXValueAttribute) as? String,
           let freshRange = try? matchRange(in: freshCurrent, text: text, prefix: prefix, suffix: suffix, selectionType: selectionType, elementIndex: elementIndex)
        {
            error = AXUIElementSetAttributeValue(fresh, kAXSelectedTextRangeAttribute as CFString, freshRange)
        }
        guard error == .success else {
            throw DaemonError.captureFailed("select_text on element \(elementIndex) failed with \(error.rawValue)")
        }
    }

    /**
     * Locate the target text with optional anchors and encode the requested
     * placement (selection, cursor before, or cursor after) as an AX range.
     */
    private static func matchRange(
        in current: String,
        text: String,
        prefix: String?,
        suffix: String?,
        selectionType: String?,
        elementIndex: Int
    ) throws -> AXValue {
        guard let found = findText(in: current, text: text, prefix: prefix, suffix: suffix) else {
            throw DaemonError.captureFailed("\"\(text)\" not found in element \(elementIndex)")
        }
        let placement = selectionType ?? "text"
        let target: CFRange
        switch placement {
        case "cursor_before": target = CFRange(location: found.location, length: 0)
        case "cursor_after": target = CFRange(location: found.location + found.length, length: 0)
        default: target = CFRange(location: found.location, length: found.length)
        }
        var rangeValue = target
        guard let axRange = AXValueCreate(.cfRange, &rangeValue) else {
            throw DaemonError.captureFailed("could not encode the selection range")
        }
        return axRange
    }

    static func drag(
        session: CaptureSession,
        app: String,
        fromX: Double,
        fromY: Double,
        toX: Double,
        toY: Double
    ) throws {
        let window = try session.capturedWindow(app: app)
        holdIdleAssertion()
        let appId = canonicalId(of: window, fallback: app)
        let from = try windowPoint(window: window, x: fromX, y: fromY)
        let to = try windowPoint(window: window, x: toX, y: toY)
        let fromLocal = CGPoint(x: fromX, y: fromY)
        let toLocal = CGPoint(x: toX, y: toY)
        try withRawEventDelivery(window: window, appId: appId) { delivery in
            try postDrag(from: from, to: to, window: window, fromLocal: fromLocal, toLocal: toLocal, delivery: delivery)
        }
    }

    static func performSecondaryAction(
        session: CaptureSession,
        app: String,
        elementIndex: Int,
        action: String
    ) throws {
        _ = try session.capturedWindow(app: app)
        let element = try session.element(app: app, index: elementIndex)
        holdIdleAssertion()
        guard let actionName = axAction(matching: action, on: element) else {
            throw DaemonError.captureFailed("element \(elementIndex) has no action matching \(action)")
        }
        if !axPerform(element, action: actionName) {
            if let fresh = session.refreshElement(app: app, index: elementIndex),
               let freshAction = axAction(matching: action, on: fresh),
               axPerform(fresh, action: freshAction) { return }
            throw DaemonError.captureFailed("action \(action) on element \(elementIndex) failed")
        }
    }

    // MARK: - Delivery mode

    /** The app's canonical bundle id from the retained window, for foreground-state bookkeeping. */
    private static func canonicalId(of window: CaptureSession.CapturedWindow, fallback app: String) -> String {
        NSRunningApplication(processIdentifier: window.pid)?.bundleIdentifier ?? app
    }

    /** Whether the app takes the full foreground path: deployment config pins it, nothing else does. */
    private static func requiresForeground(_ appId: String) -> Bool {
        foregroundApps.contains(appId)
    }

    /**
     * Raise the app and its session window into focus. Reserved for the
     * deployment-pinned foreground path only; the background path never calls it.
     */
    private static func activateForeground(window: CaptureSession.CapturedWindow) {
        if let running = NSRunningApplication(processIdentifier: window.pid) {
            running.activate(options: [.activateAllWindows])
        }
        _ = AXUIElementPerformAction(window.element, kAXRaiseAction as CFString)
        _ = AXUIElementSetAttributeValue(window.element, kAXMainAttribute as CFString, kCFBooleanTrue)
        _ = AXUIElementSetAttributeValue(window.element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        Thread.sleep(forTimeInterval: 0.15)
    }

    /** How one synthesized event reaches the desktop: directly into the app, or through the global tap. */
    private enum Delivery {
        case background(pid: pid_t)
        case globalTap

        /**
         * Post one event. Background delivery routes keyboard events through
         * the SkyLight path with the authentication envelope and falls back to
         * the public postToPid per symbol; mouse events take belt+suspenders
         * (SkyLight plus public). @param auth - false for menu key
         * equivalents (⌘V paste), whose envelope bypasses NSMenu dispatch.
         */
        func deliver(_ event: CGEvent, keyboard: Bool, auth: Bool = true) {
            switch self {
            case .background(let pid):
                if keyboard {
                    if !SkyLight.postToPid(pid: pid, event: event, attachAuth: auth) {
                        event.postToPid(pid)
                    }
                } else {
                    _ = SkyLight.postToPid(pid: pid, event: event, attachAuth: false)
                    event.postToPid(pid)
                }
            case .globalTap:
                event.post(tap: .cghidEventTap)
            }
        }
    }

    /**
     * Run one raw-event action against the target app. Apps pinned to the
     * foreground path (raise + activate + global event tap, no restore) take
     * it; everything else delivers into the app's process with no activation
     * at all, so the user's foreground never changes and nothing is restored.
     */
    private static func withRawEventDelivery(
        window: CaptureSession.CapturedWindow,
        appId: String,
        _ action: (Delivery) throws -> Void
    ) rethrows {
        if requiresForeground(appId) {
            activateForeground(window: window)
            try action(.globalTap)
            return
        }
        try action(.background(pid: window.pid))
    }

    /** A synthetic event source: HID-system for direct delivery, combined-session for the global tap. */
    private static func eventSource(for delivery: Delivery) -> CGEventSource {
        let state: CGEventSourceStateID
        switch delivery {
        case .background: state = .hidSystemState
        case .globalTap: state = .combinedSessionState
        }
        if let source = CGEventSource(stateID: state) { return source }
        return CGEventSource(stateID: .combinedSessionState)!
    }

    // MARK: - Idle assertion

    private static var idleAssertion: IOPMAssertionID = 0

    /**
     * Hold a no-idle-sleep assertion for the daemon's automation lifetime.
     * IOPMAssertions are owned by the creating process and the power manager
     * releases them automatically when it exits, so the daemon needs no
     * explicit teardown (SIGTERM kills the process, and the assertion goes
     * with it).
     */
    static func holdIdleAssertion() {
        guard idleAssertion == 0 else { return }
        let name = "dsh-computer-daemon automation" as CFString
        _ = IOPMAssertionCreateWithName(
            kIOPMAssertionTypeNoIdleSleep as CFString,
            IOPMAssertionLevel(kIOPMAssertionLevelOn),
            name,
            &idleAssertion
        )
    }

    // MARK: - CGEvent synthesis

    /** Fail the action when the user holds Escape — the presence banner's cancel affordance. */
    static func checkInterrupted() throws {
        if Presence.isEscPressed() { throw DaemonError.interrupted }
    }

    private static func postClick(at point: CGPoint, count: Int, button: String, window: CaptureSession.CapturedWindow, appId: String, method: ClickMethod) throws {
        switch method {
        case .global:
            activateForeground(window: window)
            try deliverClick(at: point, count: count, button: button, delivery: .globalTap)
        case .accessibility, .auto, .appPost, .skyClick:
            // `auto`, `app_post`, and `sky_click` share the stamped background
            // recipe; the entry point already resolved the element's AX press
            // for `auto` and `accessibility`. Left clicks take the full
            // Chromium-compatible stream; other buttons take the plain
            // background delivery.
            if button == "left" || button == "l" || button == "L" {
                try postStampedClick(at: point, count: count, window: window)
            } else {
                try withRawEventDelivery(window: window, appId: appId) { delivery in
                    try deliverClick(at: point, count: count, button: button, delivery: delivery)
                }
            }
        }
        Presence.hideCursor()
    }

    /**
     * The stamped background-click recipe (the SkyLight auth-signed click
     * path): focus the target window without raising it, then run the stamped
     * event stream — a mouseMoved cursor primer, Chromium's off-screen
     * (-1,-1) primer down/up that satisfies its user-activation gate without
     * hitting any DOM element, then the target down/up pairs. Every event
     * carries the gesture phase, click state, pid, window-routing fields, and
     * one shared click-group id; delivery posts both the SkyLight and the
     * public per-process paths. When the private SPIs are absent the stamps
     * are skipped and the plain public path carries the gesture.
     */
    private static func postStampedClick(at point: CGPoint, count: Int, window: CaptureSession.CapturedWindow) throws {
        let source = eventSource(for: .background(pid: window.pid))
        let clickGroup = Int64(Date().timeIntervalSince1970 * 1_000_000_000) % 1_000_000_000
        let windowId = window.windowId
        let frame = axFrame(window.element)
        let local = frame.map { CGPoint(x: point.x - $0.origin.x, y: point.y - $0.origin.y) }

        if windowId != 0 {
            // Focus-without-raise prep: the target window becomes the active
            // one for hit-testing without restacking anything the user sees.
            _ = SkyLight.activateWithoutRaise(pid: window.pid, windowId: windowId)
            Thread.sleep(forTimeInterval: 0.05)
        }

        func stamp(_ event: CGEvent, windowLocal: CGPoint?, clickState: Int64, phase: Int64) {
            stampBackground(event, window: window, windowLocal: windowLocal)
            _ = SkyLight.setIntegerField(event, field: 0, value: phase)
            _ = SkyLight.setIntegerField(event, field: 1, value: clickState)
            _ = SkyLight.setIntegerField(event, field: 3, value: 0)
            _ = SkyLight.setIntegerField(event, field: 7, value: 3)
            _ = SkyLight.setIntegerField(event, field: 58, value: clickGroup)
        }

        func post(_ event: CGEvent) throws {
            try checkInterrupted()
            _ = SkyLight.postToPid(pid: window.pid, event: event, attachAuth: false)
            event.postToPid(window.pid)
        }

        let offScreen = CGPoint(x: -1, y: -1)
        let offLocal = CGPoint(x: -1, y: -1)

        let move = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)
        if let move { stamp(move, windowLocal: local, clickState: 0, phase: 2); try post(move) }
        Thread.sleep(forTimeInterval: 0.015)

        let primerDown = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: offScreen, mouseButton: .left)
        if let primerDown { stamp(primerDown, windowLocal: offLocal, clickState: 1, phase: 1); try post(primerDown) }
        Thread.sleep(forTimeInterval: 0.001)
        let primerUp = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: offScreen, mouseButton: .left)
        if let primerUp { stamp(primerUp, windowLocal: offLocal, clickState: 1, phase: 2); try post(primerUp) }
        // At least one frame so Chromium reads primer and target as separate gestures.
        Thread.sleep(forTimeInterval: 0.1)

        let pairs = max(1, min(count, 2))
        for pair in 1...pairs {
            Presence.moveCursor(to: point)
            let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
            if let down { stamp(down, windowLocal: local, clickState: Int64(pair), phase: 3); try post(down) }
            Thread.sleep(forTimeInterval: 0.001)
            let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
            if let up { stamp(up, windowLocal: local, clickState: Int64(pair), phase: 3); try post(up) }
            if pair < pairs { Thread.sleep(forTimeInterval: 0.08) }
        }
        Thread.sleep(forTimeInterval: 0.15)
    }

    private static func deliverClick(at point: CGPoint, count: Int, button: String, delivery: Delivery) throws {
        let source = eventSource(for: delivery)
        let mouseButton: CGMouseButton
        switch button {
        case "right", "r": mouseButton = .right
        case "middle", "m": mouseButton = .center
        default: mouseButton = .left
        }
        for click in 1...count {
            try checkInterrupted()
            Presence.moveCursor(to: point)
            let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: mouseButton)
            down?.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            if let down { delivery.deliver(down, keyboard: false) }
            Thread.sleep(forTimeInterval: 0.05)
            let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: mouseButton)
            up?.setIntegerValueField(.mouseEventClickState, value: Int64(click))
            if let up { delivery.deliver(up, keyboard: false) }
            if click < count { Thread.sleep(forTimeInterval: 0.05) }
        }
        Thread.sleep(forTimeInterval: 0.15)
    }

    private static func postDrag(from: CGPoint, to: CGPoint, window: CaptureSession.CapturedWindow, fromLocal: CGPoint, toLocal: CGPoint, delivery: Delivery) throws {
        let source = eventSource(for: delivery)
        try checkInterrupted()
        Presence.moveCursor(to: from)
        let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)
        if let down {
            stampBackground(down, window: window, windowLocal: fromLocal)
            delivery.deliver(down, keyboard: false)
        }
        Thread.sleep(forTimeInterval: 0.01)
        let steps = 20
        for step in 1...steps {
            let t = Double(step) / Double(steps)
            let point = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
            let local = CGPoint(x: fromLocal.x + (toLocal.x - fromLocal.x) * t, y: fromLocal.y + (toLocal.y - fromLocal.y) * t)
            Presence.moveCursor(to: point)
            let drag = CGEvent(mouseEventSource: source, mouseType: .leftMouseDragged, mouseCursorPosition: point, mouseButton: .left)
            if let drag {
                stampBackground(drag, window: window, windowLocal: local)
                delivery.deliver(drag, keyboard: false)
            }
            Thread.sleep(forTimeInterval: 0.01)
        }
        let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)
        if let up {
            stampBackground(up, window: window, windowLocal: toLocal)
            delivery.deliver(up, keyboard: false)
        }
        Thread.sleep(forTimeInterval: 0.3)
        Presence.hideCursor()
    }

    private static func postScroll(at point: CGPoint, window: CaptureSession.CapturedWindow, windowLocal: CGPoint?, direction: String, pages: Double, delivery: Delivery) throws {
        let source = eventSource(for: delivery)
        try checkInterrupted()
        Presence.moveCursor(to: point)
        let lines = Int((pages * 10).rounded())
        var vertical: Int32 = 0
        var horizontal: Int32 = 0
        switch direction {
        case "up": vertical = Int32(lines)
        case "down": vertical = Int32(-lines)
        case "left": horizontal = Int32(lines)
        case "right": horizontal = Int32(-lines)
        default: break
        }
        let event = CGEvent(
            scrollWheelEvent2Source: source,
            units: .line,
            wheelCount: 2,
            wheel1: vertical,
            wheel2: horizontal,
            wheel3: 0
        )
        event?.location = point
        if let event {
            stampBackground(event, window: window, windowLocal: windowLocal)
            delivery.deliver(event, keyboard: false)
        }
        Thread.sleep(forTimeInterval: 0.15)
        Presence.hideCursor()
    }

    /** Stamp the pid and window-routing fields on one background event when the SkyLight SPIs resolve. */
    private static func stampBackground(_ event: CGEvent, window: CaptureSession.CapturedWindow, windowLocal: CGPoint?) {
        _ = SkyLight.setIntegerField(event, field: 40, value: Int64(window.pid))
        if window.windowId != 0 {
            _ = SkyLight.setIntegerField(event, field: 51, value: Int64(window.windowId))
            _ = SkyLight.setIntegerField(event, field: 91, value: Int64(window.windowId))
            _ = SkyLight.setIntegerField(event, field: 92, value: Int64(window.windowId))
        }
        if let windowLocal {
            _ = SkyLight.setWindowLocation(event, x: windowLocal.x, y: windowLocal.y)
        }
    }

    /** Layout-independent text entry: one down/up pair per scalar carrying the full unicode string. */
    private static func postUnicodeText(_ text: String, delivery: Delivery) throws {
        let source = eventSource(for: delivery)
        var count = 0
        for scalar in text.unicodeScalars {
            count += 1
            if count % 10 == 0 { try checkInterrupted() }
            let fragment = String(scalar)
            var units = Array(fragment.utf16)
            let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
            // Zero flags always: Chromium infers modifier state from the
            // flags field, so a stale Shift would leak into the next scalar.
            down?.flags = []
            down?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
            if let down { delivery.deliver(down, keyboard: true) }
            Thread.sleep(forTimeInterval: 0.01)
            let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
            up?.flags = []
            up?.keyboardSetUnicodeString(stringLength: units.count, unicodeString: &units)
            if let up { delivery.deliver(up, keyboard: true) }
            Thread.sleep(forTimeInterval: 0.01)
        }
    }

    /** Text entry via the pasteboard: save, set, paste (⌘V), then restore the user's clipboard. */
    private static func withPasteboardPaste(_ text: String, window: CaptureSession.CapturedWindow, appId: String) throws {
        let pasteboard = NSPasteboard.general
        let saved = pasteboard.pasteboardItems?.flatMap { item in
            item.types.compactMap { type in item.data(forType: type).map { data in (type, data) } }
        }
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        // Restore the user's clipboard on every exit path, including a thrown one.
        defer {
            pasteboard.clearContents()
            for (type, data) in saved ?? [] {
                pasteboard.setData(data, forType: type)
            }
        }
        let chord = KeyChord(modifiers: [55], keyCode: 9, character: nil) // ⌘V
        try withRawEventDelivery(window: window, appId: appId) { delivery in
            try postChord(chord, delivery: delivery, auth: false)
        }
    }

    /**
     * Post one parsed chord. @param auth - false for menu key equivalents:
     * with the authentication envelope `SLEventPostToPid` forks onto a
     * direct-mach path that bypasses `NSApplication.sendEvent`, so NSMenu
     * dispatch (the ⌘V paste) never sees the event.
     */
    private static func postChord(_ chord: KeyChord, delivery: Delivery, auth: Bool = true) throws {
        let source = eventSource(for: delivery)
        let flags = chordModifierFlags(chord.modifiers)
        if let keyCode = chord.keyCode {
            let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
            down?.flags = flags
            if let down { delivery.deliver(down, keyboard: true, auth: auth) }
            Thread.sleep(forTimeInterval: 0.03)
            let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
            up?.flags = flags
            if let up { delivery.deliver(up, keyboard: true, auth: auth) }
        } else if let character = chord.character {
            try postUnicodeText(character, delivery: delivery)
        }
        Thread.sleep(forTimeInterval: 0.15)
    }

    /** Modifier virtual key codes → the flags carried on the synthesized key event. */
    private static func chordModifierFlags(_ keyCodes: [CGKeyCode]) -> CGEventFlags {
        var flags: CGEventFlags = []
        for code in keyCodes {
            switch code {
            case 55: flags.insert(.maskCommand)
            case 56: flags.insert(.maskShift)
            case 58: flags.insert(.maskAlternate)
            case 59: flags.insert(.maskControl)
            default: break
            }
        }
        return flags
    }

    // MARK: - AX page scroll

    /** Perform the page-scroll action on the element or its nearest ancestor that supports it. */
    private static func axPerformPageScroll(from element: AXUIElement, action: String, count: Int) -> Bool {
        var current: AXUIElement? = element
        while let candidate = current {
            if axPerformAll(candidate, action: action, count: count) { return true }
            current = axParent(candidate)
        }
        return false
    }

    private static func axPerformAll(_ element: AXUIElement, action: String, count: Int) -> Bool {
        for _ in 0..<count {
            guard axPerform(element, action: action) else { return false }
        }
        return true
    }

    // MARK: - Text strategy

    /**
     * Choose the text-injection strategy: per-scalar unicode key events for
     * plain ASCII text in native apps; the pasteboard for non-ASCII text and
     * custom-rendered apps (Electron-family), whose renderers drop
     * unicode-string events delivered directly.
     */
    static func textStrategy(appName: String, bundleId: String?, text: String) -> TextStrategy {
        let markers = ([appName, bundleId ?? ""].joined(separator: " ")).lowercased()
        let customRendered = [
            "slack", "discord", "notion", "wechat", "wework", "feishu", "lark", "codebuddy", "electron",
        ].contains { markers.contains($0) }
        let hasNonASCII = text.unicodeScalars.contains { !$0.isASCII }
        if customRendered || hasNonASCII { return .pasteboard }
        return .unicodeEvent
    }

    // MARK: - Session and coordinates

    /** Map a window-relative point onto AX coordinates via the retained window frame. */
    private static func windowPoint(window: CaptureSession.CapturedWindow, x: Double, y: Double) throws -> CGPoint {
        guard let frame = axFrame(window.element) else {
            throw DaemonError.captureFailed("the captured window has no frame for coordinate mapping")
        }
        return CGPoint(x: frame.origin.x + x, y: frame.origin.y + y)
    }

    // MARK: - Text selection

    /** Locate the target text with optional prefix/suffix anchors; nil when the match is absent. */
    static func findText(in current: String, text: String, prefix: String?, suffix: String?) -> CFRange? {
        let content = current as NSString
        let match = { (needle: String, offset: Int) -> CFRange? in
            let range = content.range(of: needle)
            guard range.location != NSNotFound else { return nil }
            return CFRange(location: range.location + offset, length: (text as NSString).length)
        }
        if let prefix, let suffix, let range = match(prefix + text + suffix, (prefix as NSString).length) { return range }
        if let prefix, let range = match(prefix + text, (prefix as NSString).length) { return range }
        if let suffix, let range = match(text + suffix, 0) { return range }
        return match(text, 0)
    }
}

/**
 * One parsed keyboard chord: modifier virtual key codes plus either a named
 * key's virtual code or a single unicode character to synthesize.
 */
struct KeyChord {
    let modifiers: [CGKeyCode]
    let keyCode: CGKeyCode?
    let character: String?

    /** Modifier aliases accepted in chords (xdotool-style lowercase included). */
    private static let modifierKeys: [String: CGKeyCode] = [
        "Control": 59, "Ctrl": 59, "Control_L": 59, "Control_R": 59, "CTRL": 59,
        "control": 59, "ctrl": 59,
        "Shift": 56, "Shift_L": 56, "Shift_R": 56, "SHIFT": 56,
        "shift": 56,
        "Alt": 58, "Option": 58, "Alt_L": 58, "Alt_R": 58, "Option_L": 58, "Option_R": 58, "ALT": 58,
        "alt": 58, "option": 58,
        "Command": 55, "Cmd": 55, "Super": 55, "Super_L": 55, "Super_R": 55, "Meta": 55, "Win": 55,
        "command": 55, "cmd": 55, "super": 55, "meta": 55, "win": 55,
    ]

    /** Named keys and their macOS virtual codes. */
    private static let namedKeys: [String: CGKeyCode] = {
        var table: [String: CGKeyCode] = [
            "Return": 36, "Enter": 36, "Tab": 48, "Space": 49, "space": 49,
            "Escape": 53, "Esc": 53, "Delete": 51, "BackSpace": 51, "ForwardDelete": 117,
            "Left": 123, "ArrowLeft": 123, "Right": 124, "ArrowRight": 124,
            "Down": 125, "ArrowDown": 125, "Up": 126, "ArrowUp": 126,
            "Home": 115, "End": 119, "PageUp": 116, "Page_Up": 116, "PageDown": 121, "Page_Down": 121,
            "CapsLock": 57, "Help": 114,
            "grave": 50, "backtick": 50, "minus": 27, "equal": 24,
            "LeftBracket": 33, "bracketleft": 33, "RightBracket": 30, "bracketright": 30,
            "backslash": 42, "semicolon": 41, "quote": 39, "apostrophe": 39,
            "comma": 43, "period": 47, "slash": 44,
            "F1": 122, "F2": 120, "F3": 99, "F4": 118, "F5": 96, "F6": 97,
            "F7": 98, "F8": 100, "F9": 101, "F10": 109, "F11": 103, "F12": 111,
        ]
        // kVK_ANSI_* codes follow the QWERTY physical positions, not alphabetical order.
        let letterCodes: [Character: CGKeyCode] = [
            "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
            "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
            "y": 16, "t": 17, "o": 31, "u": 32, "i": 34, "p": 35, "l": 37,
            "j": 38, "k": 40, "n": 45, "m": 46,
        ]
        for (letter, keyCode) in letterCodes {
            table[String(letter)] = keyCode
            table[String(letter).uppercased()] = keyCode
        }
        let digitCodes: [CGKeyCode] = [29, 18, 19, 20, 21, 23, 22, 26, 28, 25]
        for digit in 0...9 {
            table[String(digit)] = digitCodes[digit]
            table["KP_\(digit)"] = 82 + CGKeyCode(digit) // KP_0..9 are 82..91
            table["Numpad_\(digit)"] = 82 + CGKeyCode(digit)
        }
        return table
    }()

    /** Parse a `+`-separated chord; the final token names the key or a single character. */
    static func parse(_ chord: String) throws -> KeyChord {
        let tokens = chord
            .split(separator: "+")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard !tokens.isEmpty else { throw DaemonError.captureFailed("empty key chord") }
        let key = String(tokens.last!)
        var modifiers: [CGKeyCode] = []
        for token in tokens.dropLast() {
            guard let code = modifierKeys[token] else {
                throw DaemonError.captureFailed("unknown modifier \(token) in chord \(chord)")
            }
            modifiers.append(code)
        }
        if let keyCode = namedKeys[key] {
            return KeyChord(modifiers: modifiers, keyCode: keyCode, character: nil)
        }
        if key.count == 1 {
            return KeyChord(modifiers: modifiers, keyCode: nil, character: key)
        }
        throw DaemonError.captureFailed("unknown key \(key) in chord \(chord)")
    }
}
