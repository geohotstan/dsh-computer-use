import Foundation

/**
 * Deployment browser-URL policy: allowed and denied URL prefixes read from
 * the daemon's environment at startup (the engine forwards the composition
 * config; the subprocess seam scrubs `DSH_*` names from the ambient
 * environment). The official surface gates browser actions on the current
 * URL; this policy gates every capture of a browser app, so a disallowed URL
 * fails the state read itself.
 */
enum UrlPolicy {

    /** Lowercased URL prefixes the browser may be driven on; empty allows everything except denials. */
    static var allowedPrefixes: [String] = []
    /** Lowercased URL prefixes always refused, even when also allowed. */
    static var deniedPrefixes: [String] = []

    /** Read the policy from the daemon's environment (`DSH_COMPUTER_URL_ALLOW` / `DSH_COMPUTER_URL_DENY`). */
    static func configure(_ environment: [String: String]) {
        allowedPrefixes = parse(environment["DSH_COMPUTER_URL_ALLOW"] ?? "")
        deniedPrefixes = parse(environment["DSH_COMPUTER_URL_DENY"] ?? "")
    }

    private static func parse(_ raw: String) -> [String] {
        raw.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
    }

    /** Whether a browser URL may be driven: a denial wins; otherwise the allow list decides. */
    static func isAllowed(_ url: String) -> Bool {
        let normalized = url.lowercased().trimmingCharacters(in: .whitespaces)
        if deniedPrefixes.contains(where: { normalized.hasPrefix($0) }) { return false }
        if allowedPrefixes.isEmpty { return true }
        return allowedPrefixes.contains { normalized.hasPrefix($0) }
    }
}
