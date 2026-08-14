import Foundation

/**
 * Resident daemon entry point: one JSON-RPC 2.0 request per stdin line, one
 * response per stdout line, requests processed serially. The process owns the
 * capture session (per-app tree diffs and retained element indexes), so the
 * TS engine keeps exactly one resident daemon alive for the engine's lifetime
 * and the default SIGTERM disposition terminates it at teardown.
 */

requestPermissions()
InputEngine.configureForegroundApps(ProcessInfo.processInfo.environment)
CaptureSession.configureBrowserIsolation(ProcessInfo.processInfo.environment)
UrlPolicy.configure(ProcessInfo.processInfo.environment)
SafetyPolicy.configureDeniedApps(ProcessInfo.processInfo.environment)
let session = CaptureSession()

/** Methods that synthesize input; the capture that follows them settles first. */
let actionMethods: Set<String> = [
    "click", "type_text", "press_key", "scroll", "set_value", "select_text", "drag", "perform_secondary_action",
]

func run(_ request: DaemonRequest) {
    let params = request.params
    let isAction = actionMethods.contains(request.method)
    if isAction {
        // The official pause: input waits out the lock screen, bounded, then
        // the presence banner announces the action until it finishes.
        CaptureSession.waitForUnlock()
        session.markAction()
        Presence.show(message: "DeepSeek Harness is using your computer — press Esc to cancel")
    }
    switch request.method {
    case "list_apps":
        writeResponse(id: request.id, result: AppListing.listApps(order: params["order"] as? String))

    case "permission_status":
        writeResponse(id: request.id, result: currentPermissionStatus().dictionary)

    case "request_permissions":
        writeResponse(id: request.id, result: requestPermissions().dictionary)

    case "event_stream_start":
        writeResponse(id: request.id, result: Recorder.start())

    case "event_stream_status":
        writeResponse(id: request.id, result: Recorder.status())

    case "event_stream_stop":
        writeResponse(id: request.id, result: Recorder.stop())

    case "get_app_state":
        do {
            let result = try session.capture(
                app: params["app"] as? String ?? "",
                disableDiff: params["disableDiff"] as? Bool ?? false,
                cumulativeDiff: params["cumulativeDiff"] as? Bool ?? false,
                maxTreeNodes: params["maxTreeNodes"] as? Int ?? CaptureSession.defaultMaxTreeNodes,
                maxTreeDepth: params["maxTreeDepth"] as? Int ?? CaptureSession.defaultMaxTreeDepth
            )
            writeResponse(id: request.id, result: result)
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    case "click":
        do {
            try InputEngine.click(
                session: session,
                app: params["app"] as? String ?? "",
                elementIndex: params["elementIndex"] as? Int,
                x: params["x"] as? Double,
                y: params["y"] as? Double,
                clickCount: params["clickCount"] as? Int,
                mouseButton: params["mouseButton"] as? String,
                clickMethod: params["clickMethod"] as? String
            )
            writeResponse(id: request.id, result: nil)
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    case "type_text":
        do {
            try InputEngine.typeText(
                session: session,
                app: params["app"] as? String ?? "",
                text: params["text"] as? String ?? ""
            )
            writeResponse(id: request.id, result: nil)
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    case "press_key":
        do {
            let selectedText = try InputEngine.pressKey(
                session: session,
                app: params["app"] as? String ?? "",
                key: params["key"] as? String ?? ""
            )
            writeResponse(id: request.id, result: ["selectedText": selectedText])
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    case "scroll":
        do {
            try InputEngine.scroll(
                session: session,
                app: params["app"] as? String ?? "",
                elementIndex: params["elementIndex"] as? Int ?? -1,
                direction: params["direction"] as? String ?? "",
                pages: params["pages"] as? Double
            )
            writeResponse(id: request.id, result: nil)
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    case "set_value":
        do {
            try InputEngine.setValue(
                session: session,
                app: params["app"] as? String ?? "",
                elementIndex: params["elementIndex"] as? Int ?? -1,
                value: params["value"] as? String ?? ""
            )
            writeResponse(id: request.id, result: nil)
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    case "select_text":
        do {
            try InputEngine.selectText(
                session: session,
                app: params["app"] as? String ?? "",
                elementIndex: params["elementIndex"] as? Int ?? -1,
                text: params["text"] as? String ?? "",
                prefix: params["prefix"] as? String,
                suffix: params["suffix"] as? String,
                selectionType: params["selectionType"] as? String
            )
            writeResponse(id: request.id, result: nil)
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    case "drag":
        do {
            try InputEngine.drag(
                session: session,
                app: params["app"] as? String ?? "",
                fromX: params["fromX"] as? Double ?? 0,
                fromY: params["fromY"] as? Double ?? 0,
                toX: params["toX"] as? Double ?? 0,
                toY: params["toY"] as? Double ?? 0
            )
            writeResponse(id: request.id, result: nil)
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    case "perform_secondary_action":
        do {
            try InputEngine.performSecondaryAction(
                session: session,
                app: params["app"] as? String ?? "",
                elementIndex: params["elementIndex"] as? Int ?? -1,
                action: params["action"] as? String ?? ""
            )
            writeResponse(id: request.id, result: nil)
        } catch {
            writeDaemonError(id: request.id, error: error)
        }

    default:
        writeError(id: request.id, code: -32601, message: "unknown method \(request.method)")
    }
    if isAction { Presence.hide() }
}

func writeDaemonError(id: Int, error: Error) {
    let message = (error as? DaemonError)?.errorDescription ?? "operation failed: \(error)"
    writeError(id: id, code: -32000, message: message)
}

while let line = readLine(strippingNewline: true) {
    guard let request = DaemonRequest(line) else { continue }
    run(request)
}
