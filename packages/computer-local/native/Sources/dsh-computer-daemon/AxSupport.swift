import Foundation
import ApplicationServices

/** Shared AX bridges used by capture and input. */

/** Read one accessibility attribute; nil on any failure. */
func axValue(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard error == .success else { return nil }
    return value
}

/** The element's frame in AX coordinates (top-left origin). */
func axFrame(_ element: AXUIElement) -> CGRect? {
    guard let position = axValue(element, kAXPositionAttribute),
          let size = axValue(element, kAXSizeAttribute),
          CFGetTypeID(position) == AXValueGetTypeID(),
          CFGetTypeID(size) == AXValueGetTypeID()
    else { return nil }
    var point = CGPoint.zero
    var cgSize = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
          AXValueGetValue(size as! AXValue, .cgSize, &cgSize)
    else { return nil }
    return CGRect(origin: point, size: cgSize)
}

/** The element's click target: the frame center, or the position alone as the fallback. */
func axClickPoint(_ element: AXUIElement) -> CGPoint? {
    if let frame = axFrame(element), frame.size.width > 0, frame.size.height > 0 {
        return CGPoint(x: frame.midX, y: frame.midY)
    }
    guard let position = axValue(element, kAXPositionAttribute),
          CFGetTypeID(position) == AXValueGetTypeID()
    else { return nil }
    var point = CGPoint.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point) else { return nil }
    return point
}

/** Perform one named accessibility action; false when the action failed. */
func axPerform(_ element: AXUIElement, action: String) -> Bool {
    AXUIElementPerformAction(element, action as CFString) == .success
}

/** The window number (CGWindowID) of an AX window element; 0 when unreadable. */
func axWindowId(_ window: AXUIElement) -> CGWindowID {
    (axValue(window, "AXWindowNumber") as? CGWindowID) ?? 0
}

/** The element's AX parent; nil at the application root or on any failure. */
func axParent(_ element: AXUIElement) -> AXUIElement? {
    guard let value = axValue(element, kAXParentAttribute),
          CFGetTypeID(value) == AXUIElementGetTypeID()
    else { return nil }
    return (value as! AXUIElement)
}

/** The element's action whose human label matches the given label, case-insensitively. */
func axAction(matching label: String, on element: AXUIElement) -> String? {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success,
          let names,
          let actions = names as? [String]
    else { return nil }
    let normalized = label.trimmingCharacters(in: .whitespaces).lowercased()
    return actions.first { action in
        CaptureSession.humanActionLabel(action).lowercased() == normalized
            || action.lowercased() == normalized
            || action == "AX\(label.trimmingCharacters(in: .whitespaces))"
    }
}

/** The target app's currently selected text through its focused element; nil when unavailable or empty. */
func axSelectedText(pid: pid_t) -> String? {
    let appElement = AXUIElementCreateApplication(pid)
    guard let focused = axValue(appElement, kAXFocusedUIElementAttribute) as! AXUIElement? else { return nil }
    return axValue(focused, kAXSelectedTextAttribute) as? String
}

/**
 * The browser window's current address, read from the address-and-search
 * field Chromium-family browsers expose under the stable identifier
 * `WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD`. A bounded breadth-first search; nil
 * when the field is absent or unreadable (Safari hides it from AX).
 */
func axBrowserUrl(_ window: AXUIElement) -> String? {
    var queue: [AXUIElement] = [window]
    var visited = 0
    while let element = queue.popLast(), visited < 400 {
        visited += 1
        if let identifier = axValue(element, kAXIdentifierAttribute) as? String,
           identifier == "WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD",
           let value = axValue(element, kAXValueAttribute) as? String,
           !value.isEmpty
        {
            return value
        }
        if let children = axValue(element, kAXChildrenAttribute) as? [AXUIElement] {
            queue.append(contentsOf: children)
        }
    }
    return nil
}
