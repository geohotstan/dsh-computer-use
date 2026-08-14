import Foundation

/**
 * Wire helpers for the daemon protocol: one JSON-RPC 2.0 object per line on
 * stdin (requests) and stdout (responses). The field vocabulary mirrors the
 * TS seam (camelCase); screenshot bytes ride `dataBase64` inside
 * `get_app_state` results.
 */

/** One parsed request line; nil for any non-protocol line. */
struct DaemonRequest {
    let id: Int
    let method: String
    let params: [String: Any]

    init?(_ line: String) {
        guard let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["jsonrpc"] as? String == "2.0",
              let id = object["id"] as? Int,
              let method = object["method"] as? String
        else { return nil }
        self.id = id
        self.method = method
        self.params = object["params"] as? [String: Any] ?? [:]
    }

    func stringParam(_ name: String) -> String? { params[name] as? String }
    func doubleParam(_ name: String) -> Double? { params[name] as? Double }
    func intParam(_ name: String) -> Int? { params[name] as? Int }
    func boolParam(_ name: String) -> Bool? { params[name] as? Bool }
}

/** Write one success response line for the given request id. */
func writeResponse(id: Int, result: Any?) {
    writeLine(["jsonrpc": "2.0", "id": id, "result": result ?? NSNull()])
}

/** Write one protocol-error response line for the given request id. */
func writeError(id: Int, code: Int, message: String) {
    writeLine(["jsonrpc": "2.0", "id": id, "error": ["code": code, "message": message]])
}

private func writeLine(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8)
    else { return }
    print(line)
    fflush(stdout)
}

/** Domain errors the daemon reports to the engine. */
enum DaemonError: LocalizedError {
    case accessibilityPermission
    case appNotFound(String)
    case appDenied(String)
    case systemSecurityProcess(String)
    case privateBrowsingWindow
    case orgPolicyDenied(String)
    case browserUrlDenied(String)
    case interrupted
    case captureFailed(String)
    case notImplemented(String)

    var errorDescription: String? {
        switch self {
        case .accessibilityPermission:
            return "Accessibility permission is required: grant it to this helper in System Settings > Privacy & Security > Accessibility"
        case .appNotFound(let app):
            // The official computer-use surface renders unresolved names exactly like this.
            return "appNotFound(\"\(app)\")"
        case .appDenied(let app):
            return "Computer Use is not allowed to use the app '\(app)' for safety reasons."
        case .systemSecurityProcess(let process):
            return "Computer use actions are not allowed for system security process: \(process)"
        case .privateBrowsingWindow:
            return "Computer Use is not allowed on a private browsing window. Stop and explain why; it stays disallowed even when the user navigates there themselves."
        case .orgPolicyDenied(let app):
            return "Computer Use is blocked from using the app '\(app)' by the deployment's organization policy."
        case .browserUrlDenied(let url):
            return "Computer Use is not allowed on the current browser URL (\(url)). Stop your work and send a final message noting why the session has been ended; the URL stays disallowed even when the user navigates there themselves."
        case .interrupted:
            return "Computer use action interrupted by the user (Esc). Stop the task and explain that it was cancelled."
        case .captureFailed(let reason):
            return "capture failed: \(reason)"
        case .notImplemented(let method):
            return "\(method) is not implemented"
        }
    }
}
