import Foundation
import AppKit
import ApplicationServices

/**
 * App-state capture: resolves an app by bundle id, display name, full app
 * path, or process name (launching it when needed), walks its key window's
 * accessibility tree, and serializes it into the model-readable element-index
 * format of the official Codex computer-use surface — a `App=<bundle-id> (pid N)` /
 * `Window: "<title>", App: <name>.` header, numbered lines, tab-indented
 * hierarchy, plain-language roles, parenthesized traits, and a final
 * focused-element line. The session keeps the previous tree per app so later
 * captures return a diff of it (`~` changed, `+` added, removed elements
 * summarized as id ranges), announced by the same marker lines Codex uses.
 * Captures that follow a control action settle first: a base delay plus
 * stability sampling until the tree stops changing, so post-action state does
 * not race the UI.
 */
final class CaptureSession {

    /** Default element-count bound (the official `max_tree_nodes` default); a deeper tree drowns the model context. */
    static let defaultMaxTreeNodes = 1200
    /** Default tree-depth bound (the official `max_tree_depth` default). */
    static let defaultMaxTreeDepth = 64
    /** Value-display bound for a single element's text value. */
    private static let maxValueChars = 800
    /** Diff header for repeated captures of one app. */
    private static let diffHeader = "The following is a diff from the previous accessibility tree"
    /** Cumulative-diff header for diffs against the app's initial capture. */
    private static let cumulativeDiffHeader = "The following is a cumulative diff from the initial accessibility tree"
    private static let unchangedText = "There has been no change in the accessibility tree for the previous capture."
    private static let truncationMark = "\n... (element limit reached; the tree is incomplete)\n"

    // Settle-wait bounds for captures that follow a control action (the
    // official "about 1 second, up to 5 seconds while the UI still changes").
    /** Base delay between an action and the capture that follows it. */
    static let settleBaseDelay: TimeInterval = 1.0
    /** Total settle budget measured from the action. */
    static let settleMaxTotalDelay: TimeInterval = 5.0
    /** Interval between stability probes. */
    static let settleProbeInterval: TimeInterval = 0.25
    /** Actions older than this no longer trigger a settle wait. */
    static let settleRecentActionWindow: TimeInterval = 2.0

    /** Browser bundle-id fragments that get the new-tab guidance in front of the state. */
    private static let browserBundleMarkers = [
        "safari", "chrome", "chromium", "firefox", "edge", "brave", "arc", "opera",
    ]

    /** The Codex browser guidance prepended to captures of browser apps. */
    private static let browserInstructions = """
    <app_specific_instructions>
    ## Browser Computer Use

    When navigating to a new website or starting a separate web task, prefer opening a new tab instead of reusing the current tab; reuse the current tab only when the user explicitly asks to continue there or when the current page is clearly the right place to continue the existing workflow.
    </app_specific_instructions>
    """

    struct DiffLine {
        let key: String
        let text: String
    }

    /** The retained capture target of one app: window element, pid, and window id for screenshots and coordinate mapping. */
    struct CapturedWindow {
        let element: AXUIElement
        let pid: pid_t
        let windowId: CGWindowID
    }

    /** Previous capture per canonical app id, keyed by stable element path. */
    private var lastLinesByApp: [String: [DiffLine]] = [:]

    /** The initial capture per canonical app id — the cumulative-diff baseline. */
    private var initialLinesByApp: [String: [DiffLine]] = [:]

    /** The retained key window per canonical app id, for input targeting and screenshots. */
    private var lastWindowByApp: [String: CapturedWindow] = [:]

    /** The retained element list per canonical app id, indexed by the tree's element indexes. */
    private var lastElementsByApp: [String: [AXUIElement]] = [:]

    /** The retained tree path per element index, for refetch after AX invalidation. */
    private var lastPathsByApp: [String: [String]] = [:]

    // MARK: - Browser isolation

    /** Chromium-family browser bundle ids the dedicated-profile launch supports. */
    static let isolatableBrowserBundles: Set<String> = [
        "com.google.chrome", "com.google.chrome.canary", "com.brave.browser",
        "org.chromium.chromium", "com.microsoft.edgemac", "com.microsoft.edgemac.canary",
        "com.vivaldi.vivaldi", "com.operasoftware.opera",
    ]

    /** Human-readable names matching the isolatable browsers, for name-based targeting. */
    static let isolatableBrowserNames: Set<String> = [
        "google chrome", "google chrome canary", "brave browser", "chromium",
        "microsoft edge", "microsoft edge canary", "vivaldi", "opera",
    ]

    /** Whether the deployment isolates browser targets (`DSH_COMPUTER_BROWSER_ISOLATION`). */
    static var browserIsolationEnabled = false

    /** Pids of the dedicated browser instances this session launched, keyed by target string. */
    private var dedicatedBrowserPids: [String: pid_t] = [:]

    /** Seed the browser-isolation switch from the daemon's environment. */
    static func configureBrowserIsolation(_ environment: [String: String]) {
        let raw = environment["DSH_COMPUTER_BROWSER_ISOLATION"] ?? ""
        browserIsolationEnabled = raw == "1" || raw.lowercased() == "true"
    }

    /** Whether a target string names an isolatable Chromium-family browser. */
    private static func isIsolatableBrowser(_ target: String) -> Bool {
        let lowered = target.lowercased()
        return isolatableBrowserBundles.contains(lowered) || isolatableBrowserNames.contains(lowered)
    }

    /** Testing shim for the private target classification. */
    static func isIsolatableBrowserForTesting(_ target: String) -> Bool {
        isIsolatableBrowser(target)
    }

    /** Wall-clock time of the most recent control action, for settle waits. */
    private var lastActionWallTime: TimeInterval = 0

    /** Record that a control action just ran; the next capture settles before reading the tree. */
    func markAction() {
        lastActionWallTime = Date().timeIntervalSince1970
    }

    /** Whether a capture right now owes a settle wait for the given action time. */
    static func needsSettleWait(now: TimeInterval, lastAction: TimeInterval) -> Bool {
        now - lastAction < settleRecentActionWindow
    }

    /** Remaining base delay for a settle wait, or zero when the base delay has elapsed. */
    static func settleBaseRemaining(now: TimeInterval, lastAction: TimeInterval) -> TimeInterval {
        max(0, settleBaseDelay - (now - lastAction))
    }

    /**
     * Capture the key window of the given app.
     * @param app - bundle id, display name, or process name.
     * @param disableDiff - return the full tree instead of a diff.
     * @param cumulativeDiff - diff against the app's initial capture instead of the previous one.
     * @param maxTreeNodes - element-count bound for this capture.
     * @param maxTreeDepth - tree-depth bound for this capture.
     * @returns the wire result: canonical app id, model-facing text, and the
     *   window screenshot (null until the capture backend attaches one).
     */
    func capture(app: String, disableDiff: Bool, cumulativeDiff: Bool, maxTreeNodes: Int, maxTreeDepth: Int) throws -> [String: Any] {
        guard AXIsProcessTrusted() else { throw DaemonError.accessibilityPermission }
        let target = app.trimmingCharacters(in: .whitespaces)
        let pid = try resolveTarget(target)
        let canonicalId = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? target
        let appElement = AXUIElementCreateApplication(pid)
        guard let window = try preferredWindow(of: appElement, canonicalId: canonicalId, pid: pid) else {
            throw DaemonError.captureFailed("no accessible window for \(app)")
        }
        // Browser private windows are refused outright: reading or driving one
        // leaks private-browsing content, so the denial covers captures too.
        if Self.browserBundleMarkers.contains(where: { canonicalId.lowercased().contains($0) }),
           let title = axValue(window, kAXTitleAttribute) as? String,
           SafetyPolicy.isPrivateWindowTitle(title)
        {
            throw DaemonError.privateBrowsingWindow
        }
        // The deployment's browser-URL policy gates the capture itself: a
        // disallowed URL fails the state read, so no action can follow it.
        if Self.browserBundleMarkers.contains(where: { canonicalId.lowercased().contains($0) }),
           let url = axBrowserUrl(window),
           !UrlPolicy.isAllowed(url)
        {
            throw DaemonError.browserUrlDenied(url)
        }
        Self.waitForUnlock()
        settleAfterAction(window: window)

        var lines: [DiffLine] = []
        var elements: [AXUIElement] = []
        var paths: [String] = []
        var focusedDescriptor: (index: Int, descriptor: String)?
        var index = 0
        walk(
            window,
            depth: 0,
            path: "0",
            maxDepth: maxTreeDepth,
            maxNodes: maxTreeNodes,
            index: &index,
            lines: &lines,
            elements: &elements,
            paths: &paths,
            focusedDescriptor: &focusedDescriptor
        )
        lines.append(contentsOf: selectionNote(pid: pid))
        lines.append(contentsOf: appNotes(canonicalId: canonicalId, window: window))

        let windowId = (axValue(window, "AXWindowNumber") as? CGWindowID) ?? 0
        lastWindowByApp[canonicalId] = CapturedWindow(element: window, pid: pid, windowId: windowId)
        lastElementsByApp[canonicalId] = elements
        lastPathsByApp[canonicalId] = paths
        let header = Self.headerText(canonicalId: canonicalId, pid: pid, window: window)
        let text = fullText(header: header, lines: lines, focusedDescriptor: focusedDescriptor)

        let captured = lines + focusLine(focusedDescriptor)
        let resultText: String
        if disableDiff {
            resultText = text
        } else if cumulativeDiff, let initial = initialLinesByApp[canonicalId] {
            resultText = Self.cumulativeDiffText(header: header, current: captured, initial: initial)
        } else if let previous = lastLinesByApp[canonicalId] {
            resultText = Self.diffText(header: header, current: captured, previous: previous)
        } else {
            resultText = text
        }
        if initialLinesByApp[canonicalId] == nil { initialLinesByApp[canonicalId] = captured }
        lastLinesByApp[canonicalId] = captured
        // The screenshot is confirmation, never the carrier: a failed capture
        // degrades to tree-only state instead of failing the whole call.
        var screenshot: Any = NSNull()
        if windowId != 0, let shot = try? Screenshot.capture(windowId: windowId) {
            screenshot = shot
        }
        return ["app": canonicalId, "text": resultText, "screenshot": screenshot]
    }

    // MARK: - App resolution with the safety policy

    /** Resolve the target to a running pid, launching it when needed and denying unsafe targets. */
    private func resolveTarget(_ target: String) throws -> pid_t {
        // A denylisted bundle id passed directly gets the official safety
        // denial even when the app is not running; a human-readable denylisted
        // name never resolves and yields appNotFound, like the official surface.
        if SafetyPolicy.isDenied(bundleId: target) { throw DaemonError.appDenied(target) }
        if let pid = resolveRunningPid(target) {
            if let bundleId = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier {
                if SafetyPolicy.isDenied(bundleId: bundleId) { throw DaemonError.appDenied(bundleId) }
                if SafetyPolicy.isConfiguredDenied(bundleId: bundleId) { throw DaemonError.orgPolicyDenied(bundleId) }
            }
            try Self.assertNotSystemSecurityProcess(pid)
            return pid
        }
        if SafetyPolicy.isDenied(name: target) { throw DaemonError.appNotFound(target) }
        guard let launched = launchApp(target) else { throw DaemonError.appNotFound(target) }
        if let bundleId = NSRunningApplication(processIdentifier: launched)?.bundleIdentifier {
            if SafetyPolicy.isDenied(bundleId: bundleId) { throw DaemonError.appDenied(bundleId) }
            if SafetyPolicy.isConfiguredDenied(bundleId: bundleId) { throw DaemonError.orgPolicyDenied(bundleId) }
        }
        try Self.assertNotSystemSecurityProcess(launched)
        return launched
    }

    /** Deny a resolved process that is a system security process (the official dynamic check). */
    private static func assertNotSystemSecurityProcess(_ pid: pid_t) throws {
        guard let running = NSRunningApplication(processIdentifier: pid),
              SafetyPolicy.isSystemSecurityProcess(running)
        else { return }
        throw DaemonError.systemSecurityProcess(running.localizedName ?? running.executableURL?.path ?? "\(pid)")
    }

    // MARK: - Retained capture state

    /**
     * Resolve the retained capture window for an app. The app's current pid
     * must still own the session — a relaunched app invalidates it, and the
     * caller must capture again.
     * @param app - bundle id, display name, or process name.
     * @returns the retained window plus pid and window id.
     */
    func capturedWindow(app: String) throws -> CapturedWindow {
        let target = app.trimmingCharacters(in: .whitespaces)
        guard let pid = resolveRunningPid(target) else { throw DaemonError.appNotFound(app) }
        let canonicalId = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? target
        guard let window = lastWindowByApp[canonicalId], window.pid == pid else {
            throw DaemonError.captureFailed("no capture session for \(app); call get_app_state first")
        }
        return window
    }

    /**
     * Resolve one retained element by its tree index from the latest capture.
     * @param app - the captured app identifier.
     * @param index - the element index from the tree.
     * @returns the retained AX element.
     */
    func element(app: String, index: Int) throws -> AXUIElement {
        let window = try capturedWindow(app: app)
        let canonicalId = NSRunningApplication(processIdentifier: window.pid)?.bundleIdentifier ?? app
        guard let elements = lastElementsByApp[canonicalId], index >= 0, index < elements.count else {
            throw DaemonError.captureFailed("element index \(index) is not in the latest capture of \(app)")
        }
        return elements[index]
    }

    /**
     * Refetch an element after AX invalidation: re-walk the captured window,
     * locate the element at the retained tree path of the given index, and
     * replace the retained element list so later actions use fresh elements.
     * @returns the refreshed element, or nil when the path no longer exists.
     */
    func refreshElement(app: String, index: Int) -> AXUIElement? {
        guard let window = try? capturedWindow(app: app) else { return nil }
        let canonicalId = NSRunningApplication(processIdentifier: window.pid)?.bundleIdentifier ?? app
        guard let retainedPaths = lastPathsByApp[canonicalId], index >= 0, index < retainedPaths.count else { return nil }
        let wanted = retainedPaths[index]

        var lines: [DiffLine] = []
        var elements: [AXUIElement] = []
        var paths: [String] = []
        var focused: (index: Int, descriptor: String)? = nil
        var counter = 0
        walk(
            window.element,
            depth: 0,
            path: "0",
            maxDepth: Self.defaultMaxTreeDepth,
            maxNodes: Self.defaultMaxTreeNodes,
            index: &counter,
            lines: &lines,
            elements: &elements,
            paths: &paths,
            focusedDescriptor: &focused
        )
        guard let freshIndex = paths.firstIndex(of: wanted) else { return nil }
        let fresh = elements[freshIndex]
        lastElementsByApp[canonicalId] = elements
        lastPathsByApp[canonicalId] = paths
        return fresh
    }

    // MARK: - Tree walk

    private func walk(
        _ element: AXUIElement,
        depth: Int,
        path: String,
        maxDepth: Int,
        maxNodes: Int,
        index: inout Int,
        lines: inout [DiffLine],
        elements: inout [AXUIElement],
        paths: inout [String],
        focusedDescriptor: inout (index: Int, descriptor: String)?
    ) {
        if index >= maxNodes {
            if lines.last?.key != "limit" {
                lines.append(DiffLine(key: "limit", text: CaptureSession.truncationMark))
            }
            return
        }
        let descriptor = describe(element)
        let rendered = String(repeating: "\t", count: depth) + "\(index) \(descriptor)"
        lines.append(DiffLine(key: path, text: rendered))
        elements.append(element)
        paths.append(path)
        let isFocused = (axValue(element, kAXFocusedAttribute) as? Bool) ?? false
        if isFocused && focusedDescriptor == nil {
            focusedDescriptor = (index, descriptor)
        }
        index += 1

        guard depth < maxDepth else { return }
        guard let children = axValue(element, kAXChildrenAttribute) as? [AXUIElement] else { return }
        for (childIndex, child) in children.enumerated() {
            walk(
                child,
                depth: depth + 1,
                path: "\(path)/\(childIndex)",
                maxDepth: maxDepth,
                maxNodes: maxNodes,
                index: &index,
                lines: &lines,
                elements: &elements,
                paths: &paths,
                focusedDescriptor: &focusedDescriptor
            )
        }
    }

    // MARK: - Element description

    /** One element's model-readable descriptor: role, title, description, traits, value, help, id, secondary actions. */
    private func describe(_ element: AXUIElement) -> String {
        var parts: [String] = [roleName(element)]
        if let title = axValue(element, kAXTitleAttribute) as? String, !title.isEmpty {
            parts.append(title)
        }
        if let description = axValue(element, kAXDescriptionAttribute) as? String, !description.isEmpty {
            parts.append("Description: \(description)")
        }
        let traits = traitsText(element)
        if !traits.isEmpty { parts.append("(\(traits))") }
        if let value = axValue(element, kAXValueAttribute), let display = displayValue(value) {
            parts.append("Value: \(display)")
        }
        if let help = axValue(element, kAXHelpAttribute) as? String, !help.isEmpty {
            parts.append("Help: \(help)")
        }
        if let identifier = presentableIdentifier(of: element) {
            parts.append("ID: \(identifier)")
        }
        let actions = secondaryActions(element)
        if !actions.isEmpty {
            parts.append("Secondary Actions: \(actions.joined(separator: ", "))")
        }
        return parts.joined(separator: " ")
    }

    /** The element's AX identifier when it is a real identifier; `_NS:`-prefixed internals stay hidden. */
    private func presentableIdentifier(of element: AXUIElement) -> String? {
        guard let identifier = axValue(element, kAXIdentifierAttribute) as? String, !identifier.isEmpty else { return nil }
        if identifier.hasPrefix("_NS:") || identifier.hasPrefix("Target:") || identifier.hasPrefix("Selector:") { return nil }
        return identifier
    }

    /** Plain-language role from the role/subrole pair, falling back to spaced role words. */
    private func roleName(_ element: AXUIElement) -> String {
        let role = axValue(element, kAXRoleAttribute) as? String ?? "element"
        let subrole = axValue(element, kAXSubroleAttribute) as? String
        if role == "AXWindow" {
            if subrole == "AXStandardWindow" { return "standard window" }
            if subrole == "AXDialog" { return "dialog window" }
            return "window"
        }
        let vocabulary: [String: String] = [
            "AXTextArea": "text entry area",
            "AXTextField": "text field",
            "AXStaticText": "static text",
            "AXPopUpButton": "pop up button",
            "AXCheckBox": "checkbox",
            "AXRadioButton": "radio button",
            "AXScrollArea": "scroll area",
            "AXMenuButton": "menu button",
            "AXMenuItem": "menu item",
            "AXTable": "table",
            "AXRow": "row",
            "AXColumn": "column",
            "AXCell": "cell",
            "AXSlider": "slider",
            "AXTabGroup": "tab group",
            "AXToolbar": "toolbar",
            "AXSplitGroup": "split group",
            "AXLink": "link",
            "AXHeading": "heading",
            "AXList": "list",
            "AXOutline": "outline",
            "AXColorWell": "color well",
            "AXProgressIndicator": "progress indicator",
            "AXDisclosureTriangle": "disclosure triangle",
            "AXSplitter": "splitter",
        ]
        if let mapped = vocabulary[role] { return mapped }
        return Self.spacedRole(role)
    }

    /** Fallback: `AXFooBar` → `foo bar`. */
    static func spacedRole(_ role: String) -> String {
        let base = role.hasPrefix("AX") ? String(role.dropFirst(2)) : role
        var spaced = ""
        for character in base {
            if character.isUppercase && !spaced.isEmpty { spaced.append(" ") }
            spaced.append(character.lowercased())
        }
        return spaced.isEmpty ? role : spaced
    }

    /** `disabled`, `settable`, and the value type name, in Codex's parenthesized order. */
    private func traitsText(_ element: AXUIElement) -> String {
        var traits: [String] = []
        let enabled = axValue(element, kAXEnabledAttribute) as? Bool ?? true
        if !enabled { traits.append("disabled") }
        var settable = DarwinBoolean(false)
        if AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success,
           settable.boolValue,
           let value = axValue(element, kAXValueAttribute),
           let type = valueTypeName(value)
        {
            traits.append("settable")
            traits.append(type)
        }
        return traits.joined(separator: ", ")
    }

    private func valueTypeName(_ value: AnyObject) -> String? {
        let type = CFGetTypeID(value)
        if type == CFStringGetTypeID() { return "string" }
        if type == CFNumberGetTypeID() {
            let number = value as! CFNumber
            return CFNumberGetType(number) == .floatType || CFNumberGetType(number) == .doubleType
                ? "float" : "number"
        }
        if type == CFBooleanGetTypeID() { return "boolean" }
        return nil
    }

    private func displayValue(_ value: AnyObject) -> String? {
        let type = CFGetTypeID(value)
        if type == CFStringGetTypeID() {
            let text = value as! String
            return text.count > CaptureSession.maxValueChars
                ? String(text.prefix(CaptureSession.maxValueChars)) + "…"
                : text
        }
        if type == CFNumberGetTypeID() { return "\(value)" }
        if type == CFBooleanGetTypeID() { return CFEqual(value, kCFBooleanTrue) ? "true" : "false" }
        return nil
    }

    /** Named accessibility actions other than the primary press, as human labels. */
    private func secondaryActions(_ element: AXUIElement) -> [String] {
        actionNames(element)
            .filter { $0 != "AXPress" }
            .map { Self.humanActionLabel($0) }
    }

    private func actionNames(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        let error = AXUIElementCopyActionNames(element, &names)
        guard error == .success, let names else { return [] }
        return names as? [String] ?? []
    }

    /** `AXScrollLeftByPage` → `Scroll Left By Page` (the display and round-trip vocabulary). */
    static func humanActionLabel(_ actionName: String) -> String {
        let base = actionName.hasPrefix("AX") ? String(actionName.dropFirst(2)) : actionName
        var spaced = ""
        for character in base {
            if character.isUppercase && !spaced.isEmpty { spaced.append(" ") }
            spaced.append(character)
        }
        return spaced.isEmpty ? actionName : spaced
    }

    // MARK: - Text assembly

    private func focusLine(_ focused: (index: Int, descriptor: String)?) -> [DiffLine] {
        guard let focused else { return [] }
        return [DiffLine(key: "focus", text: "The focused UI element is \(focused.index) \(focused.descriptor)")]
    }

    private func fullText(header: String, lines: [DiffLine], focusedDescriptor: (index: Int, descriptor: String)?) -> String {
        var parts = [header] + lines.map { $0.text }
        if let focused = focusedDescriptor {
            parts.append("The focused UI element is \(focused.index) \(focused.descriptor)")
        }
        return parts.joined(separator: "\n")
    }

    /** The official surface header: browser guidance when applicable, then `App=…` and `Window: …`. */
    private static func headerText(canonicalId: String, pid: pid_t, window: AXUIElement) -> String {
        let appName = NSRunningApplication(processIdentifier: pid)?.localizedName ?? canonicalId
        let title = (axValue(window, kAXTitleAttribute) as? String) ?? ""
        var parts: [String] = []
        if browserBundleMarkers.contains(where: { canonicalId.lowercased().contains($0) }) {
            parts.append(browserInstructions)
        }
        parts.append("App=\(canonicalId) (pid \(pid))")
        parts.append("Window: \"\(title)\", App: \(appName).")
        return parts.joined(separator: "\n")
    }

    /**
     * Diff the current capture against the previous one: `~` marks a changed
     * line, `+` an added line, and removed elements collapse into one id-range
     * summary (the official token-saving format). An empty diff returns the
     * unchanged sentence.
     */
    static func diffText(header: String, current: [DiffLine], previous: [DiffLine]) -> String {
        let output = diffOutput(current: current, previous: previous)
        if output.isEmpty { return header + "\n" + CaptureSession.unchangedText }
        return header + "\n" + CaptureSession.diffHeader + "\n" + output.joined(separator: "\n")
    }

    /**
     * Diff the current capture against the app's initial capture (the official
     * cumulative diff), announced by its own marker line.
     */
    static func cumulativeDiffText(header: String, current: [DiffLine], initial: [DiffLine]) -> String {
        let output = diffOutput(current: current, previous: initial)
        if output.isEmpty { return header + "\n" + CaptureSession.unchangedText }
        return header + "\n" + CaptureSession.cumulativeDiffHeader + "\n" + output.joined(separator: "\n")
    }

    /** The shared diff-line builder: `~` changed, `+` added, removed ids summarized as ranges. */
    private static func diffOutput(current: [DiffLine], previous: [DiffLine]) -> [String] {
        var previousByKey: [String: String] = [:]
        for line in previous { previousByKey[line.key] = line.text }
        var currentByKey: [String: String] = [:]
        for line in current { currentByKey[line.key] = line.text }

        var output: [String] = []
        for line in current {
            if let old = previousByKey[line.key] {
                if old != line.text { output.append("~ \(line.text)") }
            } else {
                output.append("+ \(line.text)")
            }
        }
        var removedIds: [Int] = []
        for line in previous where currentByKey[line.key] == nil {
            if let index = leadingIndex(of: line.text) { removedIds.append(index) }
        }
        if !removedIds.isEmpty {
            output.append("Removed element IDs: \(summarizeRanges(removedIds))")
        }
        return output
    }

    /** The element index a tree line renders: the line's number after its indent, when whitespace follows it. */
    static func leadingIndex(of text: String) -> Int? {
        let trimmed = text.drop(while: { $0 == "\t" || $0 == " " })
        let digits = trimmed.prefix(while: { $0.isNumber })
        guard !digits.isEmpty, let after = trimmed.dropFirst(digits.count).first, after.isWhitespace else { return nil }
        return Int(digits)
    }

    /** Compress a list of element indexes into comma-separated ranges: `[2, 3, 4, 7]` → `2–4, 7`. */
    static func summarizeRanges(_ ids: [Int]) -> String {
        let sorted = ids.sorted()
        guard let first = sorted.first else { return "" }
        var parts: [String] = []
        var start = first
        var previous = first
        for id in sorted.dropFirst() {
            if id == previous + 1 {
                previous = id
                continue
            }
            parts.append(start == previous ? "\(start)" : "\(start)–\(previous)")
            start = id
            previous = id
        }
        parts.append(start == previous ? "\(start)" : "\(start)–\(previous)")
        return parts.joined(separator: ", ")
    }

    // MARK: - Settle wait and screen lock

    /**
     * Wait while the session is at the lock screen (the official pause): the
     * capture is delayed until the user unlocks, bounded so a stuck session
     * cannot hang the daemon forever. Actions use the same bound before
     * dispatching input. The presence banner announces the pause.
     */
    static func waitForUnlock() {
        let deadline = Date().timeIntervalSince1970 + Self.maxLockWait
        while Self.isScreenLocked() && Date().timeIntervalSince1970 < deadline {
            Presence.show(message: "DeepSeek Harness is paused — unlock your Mac to continue")
            Thread.sleep(forTimeInterval: 0.5)
        }
        Presence.hide()
    }

    /** Maximum time a capture waits for the user to unlock the screen. */
    static let maxLockWait: TimeInterval = 30

    /** Whether the login session is currently at the lock screen. */
    static func isScreenLocked() -> Bool {
        guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else { return false }
        return (session["CGSSessionScreenIsLocked"] as? Bool) ?? false
    }

    /**
     * Settle before reading the tree when a control action just ran: wait out
     * the base delay, then sample the tree until two consecutive probes match
     * or the total budget from the action expires. The probe reuses the tree
     * walk with the default bounds; the requested bounds apply to the real
     * capture that follows.
     */
    private func settleAfterAction(window: AXUIElement) {
        let now = Date().timeIntervalSince1970
        guard Self.needsSettleWait(now: now, lastAction: lastActionWallTime) else { return }
        let remaining = Self.settleBaseRemaining(now: now, lastAction: lastActionWallTime)
        if remaining > 0 { Thread.sleep(forTimeInterval: remaining) }
        let deadline = lastActionWallTime + Self.settleMaxTotalDelay
        var previous = probeText(window)
        while Date().timeIntervalSince1970 < deadline {
            Thread.sleep(forTimeInterval: Self.settleProbeInterval)
            let current = probeText(window)
            if current == previous { return }
            previous = current
        }
    }

    /** One bounded tree probe for stability sampling: the rendered lines joined into one string. */
    private func probeText(_ window: AXUIElement) -> String {
        var lines: [DiffLine] = []
        var elements: [AXUIElement] = []
        var paths: [String] = []
        var focused: (index: Int, descriptor: String)? = nil
        var index = 0
        walk(
            window,
            depth: 0,
            path: "0",
            maxDepth: Self.defaultMaxTreeDepth,
            maxNodes: Self.defaultMaxTreeNodes,
            index: &index,
            lines: &lines,
            elements: &elements,
            paths: &paths,
            focusedDescriptor: &focused
        )
        return lines.map { $0.text }.joined(separator: "\n")
    }

    // MARK: - Selection note

    /**
     * The capture lines for the user's current system selection: a guidance
     * note plus the selected text in a fenced block, appended when a
     * non-empty selection exists (the official capture enrichment).
     */
    private func selectionNote(pid: pid_t) -> [DiffLine] {
        guard let selected = axSelectedText(pid: pid), !selected.isEmpty else { return [] }
        return [
            DiffLine(key: "selection-note", text: "Note: The user may be referring to the selected text below when they mention what they are looking at."),
            DiffLine(key: "selection", text: "Selected text: ```\n\(selected)\n```"),
        ]
    }

    // MARK: - App-specific notes

    /**
     * Per-app content guidance appended to captures, mirroring the official
     * app-specific notes: Spotify link rewriting, and attachment caveats on
     * Google Workspace editors (detected through the key window title).
     */
    private func appNotes(canonicalId: String, window: AXUIElement) -> [DiffLine] {
        var notes: [DiffLine] = []
        if canonicalId.lowercased() == "com.spotify.client" {
            notes.append(DiffLine(
                key: "app-note-spotify",
                text: "Note: Spotify app links work only when rewritten as regular links (open.spotify.com instead of xpui.app.spotify.com), and a link id is only valid with its own link type."
            ))
        }
        let title = (axValue(window, kAXTitleAttribute) as? String ?? "").lowercased()
        if title.contains("google docs") || title.contains("google sheets") || title.contains("google slides") {
            notes.append(DiffLine(
                key: "app-note-google-workspace",
                text: "Note: Content inside embedded attachments may be missing from the accessibility tree; ask the user to open an attachment when its text matters."
            ))
        }
        return notes
    }

    // MARK: - App resolution

    private func resolveRunningPid(_ target: String) -> pid_t? {
        // A deployment-isolated browser never resolves to the user's running
        // instance: the session's dedicated instance, or nothing (the launch
        // path below creates the dedicated instance).
        if Self.browserIsolationEnabled, Self.isIsolatableBrowser(target) {
            if let dedicated = dedicatedBrowserPids[target],
               let running = NSRunningApplication(processIdentifier: dedicated),
               !running.isTerminated
            {
                return dedicated
            }
            return nil
        }
        return scanRunningPid(target)
    }

    /** The running-instance scan: bundle id, display name, then full app path. */
    private func scanRunningPid(_ target: String) -> pid_t? {
        let regular = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
        for candidate in regular where candidate.bundleIdentifier?.caseInsensitiveCompare(target) == .orderedSame {
            return candidate.processIdentifier
        }
        for candidate in regular {
            let name = candidate.localizedName ?? candidate.executableURL?.lastPathComponent ?? ""
            if name.caseInsensitiveCompare(target) == .orderedSame { return candidate.processIdentifier }
        }
        // A full app path also resolves: the bundle path or the executable
        // inside it (the official surface accepts "full app path" targets).
        if target.hasPrefix("/") {
            let normalized = (target as NSString).standardizingPath
            for candidate in regular {
                let executable = candidate.executableURL?.path
                let bundle = candidate.bundleURL?.path
                if executable?.caseInsensitiveCompare(normalized) == .orderedSame
                    || bundle?.caseInsensitiveCompare(normalized) == .orderedSame
                {
                    return candidate.processIdentifier
                }
            }
        }
        return nil
    }

    private func launchApp(_ target: String) -> pid_t? {
        if Self.browserIsolationEnabled, Self.isIsolatableBrowser(target) {
            return launchDedicatedBrowser(target)
        }
        // Background launch: the agent's app must never steal the user's
        // foreground, so LaunchServices is told not to activate it.
        if target.hasPrefix("/") {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false
            NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: target), configuration: configuration)
            let normalized = (target as NSString).standardizingPath
            for _ in 0..<50 {
                for candidate in NSWorkspace.shared.runningApplications
                    where candidate.executableURL?.path.caseInsensitiveCompare(normalized) == .orderedSame
                        || candidate.bundleURL?.path.caseInsensitiveCompare(normalized) == .orderedSame
                {
                    return candidate.processIdentifier
                }
                Thread.sleep(forTimeInterval: 0.1)
            }
            return nil
        }
        if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: target) {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false
            NSWorkspace.shared.openApplication(at: url, configuration: configuration)
        } else {
            // Name match: delegate resolution to Launch Services. Force
            // Chromium/Electron apps to build their accessibility tree from
            // launch (AXManualAccessibility), so browsers and VS Code expose
            // structured elements instead of screenshot-only pixels.
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            process.arguments = ["-g", "-a", target]
            process.environment = ProcessInfo.processInfo.environment.merging(["AXManualAccessibility": "1"]) { _, new in new }
            try? process.run()
        }
        for _ in 0..<50 {
            if let pid = resolveRunningPid(target) { return pid }
            Thread.sleep(forTimeInterval: 0.1)
        }
        return nil
    }

    /**
     * Launch a dedicated browser instance with its own user-data directory,
     * so the agent never touches the user's logged-in profile, tabs, or
     * windows. `open -n` starts a fresh process even when the browser is
     * already running; the launch then identifies the NEW instance by pid
     * delta, so the user's running browser is never adopted. The profile
     * lives in the daemon's temporary directory. Chromium-family apps
     * self-activate a few frames after launch, so the launch registers a
     * focus-steal suppression that hands the foreground back to the user's
     * app. Safari cannot be isolated (single-instance by design) and is
     * deliberately not in the isolatable set.
     */
    private func launchDedicatedBrowser(_ target: String) -> pid_t? {
        let safeName = target.replacingOccurrences(of: "/", with: "_")
        let profileDir = NSTemporaryDirectory() + "dsh-browser-\(safeName)"
        try? FileManager.default.createDirectory(atPath: profileDir, withIntermediateDirectories: true)
        let before = Set(allMatchingPids(target))
        let restoreTo = NSWorkspace.shared.frontmostApplication
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        // `-b` for bundle ids, `-a` for names and paths; `-n` forces a fresh
        // instance, `-g` keeps the launch backgrounded.
        let selector = !target.contains("/") && target.contains(".") ? "-ngb" : "-nga"
        process.arguments = [
            selector, target, "--args",
            "--user-data-dir=\(profileDir)",
            "--no-first-run",
            "--no-default-browser-check",
        ]
        process.environment = ProcessInfo.processInfo.environment.merging(["AXManualAccessibility": "1"]) { _, new in new }
        try? process.run()
        for _ in 0..<50 {
            if let fresh = Set(allMatchingPids(target)).subtracting(before).first {
                dedicatedBrowserPids[target] = fresh
                FocusStealPreventer.shared.suppress(pid: fresh, restoreTo: restoreTo)
                return fresh
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        return nil
    }

    /** Every running pid the target could resolve to, by the same matching rules as {@link scanRunningPid}. */
    private func allMatchingPids(_ target: String) -> [pid_t] {
        let regular = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
        var matches: [pid_t] = []
        let normalized = target.hasPrefix("/") ? (target as NSString).standardizingPath : nil
        for candidate in regular {
            if candidate.bundleIdentifier?.caseInsensitiveCompare(target) == .orderedSame {
                matches.append(candidate.processIdentifier)
                continue
            }
            let name = candidate.localizedName ?? candidate.executableURL?.lastPathComponent ?? ""
            if name.caseInsensitiveCompare(target) == .orderedSame {
                matches.append(candidate.processIdentifier)
                continue
            }
            if let normalized {
                let executable = candidate.executableURL?.path
                let bundle = candidate.bundleURL?.path
                if executable?.caseInsensitiveCompare(normalized) == .orderedSame
                    || bundle?.caseInsensitiveCompare(normalized) == .orderedSame
                {
                    matches.append(candidate.processIdentifier)
                }
            }
        }
        return matches
    }

    /**
     * The capture target: the retained window from the previous capture while
     * it still exists under the same pid — the human switching the app's
     * windows or tabs must not re-target the agent's session — falling back
     * to the app's live key window on the first capture or after a relaunch.
     */
    private func preferredWindow(of appElement: AXUIElement, canonicalId: String, pid: pid_t) throws -> AXUIElement? {
        if let retained = lastWindowByApp[canonicalId], retained.pid == pid {
            let retainedId = axWindowId(retained.element)
            if retainedId != 0,
               let windows = axValue(appElement, kAXWindowsAttribute) as? [AXUIElement],
               let match = windows.first(where: { axWindowId($0) == retainedId })
            {
                return match
            }
        }
        return try keyWindow(of: appElement)
    }

    private func keyWindow(of appElement: AXUIElement) throws -> AXUIElement? {
        if let focused = axValue(appElement, kAXFocusedWindowAttribute) as! AXUIElement? { return focused }
        if let main = axValue(appElement, kAXMainWindowAttribute) as! AXUIElement? { return main }
        let windows = axValue(appElement, kAXWindowsAttribute) as? [AXUIElement] ?? []
        return windows.first
    }

}
