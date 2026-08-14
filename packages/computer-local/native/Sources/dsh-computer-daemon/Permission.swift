import Foundation
import AppKit
import ApplicationServices
import CoreGraphics

/**
 * TCC permission preflight: bundle-identity detection, prompt-and-open-Settings
 * requests, and the wire status the daemon reports through `permission_status`.
 * Lives outside main.swift so the pure identity check is testable — globals in
 * a top-level-code file initialize only when that code runs.
 */

/** The bundle id the signed .app must carry for TCC prompts to attribute to this helper. */
let daemonBundleId = "com.deepseek-ai.dsh-computer-daemon"

/** Whether the given bundle identifier is the daemon's own .app identity. */
func hasDaemonBundleIdentity(_ identifier: String?) -> Bool {
    identifier == daemonBundleId
}

/** The two TCC grants the daemon needs plus its bundle identity, reported to the engine as one status. */
struct PermissionStatus {
    let accessibility: Bool
    let screenRecording: Bool
    let bundled: Bool

    /** Wire payload for the `permission_status` method. */
    var dictionary: [String: Any] {
        ["accessibility": accessibility, "screenRecording": screenRecording, "bundled": bundled]
    }
}

/** Whether this process runs from its signed .app bundle, so TCC attributes prompts to it. */
private func isBundled() -> Bool {
    hasDaemonBundleIdentity(Bundle.main.bundleIdentifier)
}

/** Current grant state, read without prompting the user. */
func currentPermissionStatus() -> PermissionStatus {
    PermissionStatus(
        accessibility: AXIsProcessTrusted(),
        screenRecording: CGPreflightScreenCaptureAccess(),
        bundled: isBundled()
    )
}

/** Open one Privacy & Security sub-pane in System Settings. */
func openPrivacyPane(_ pane: String) {
    guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(pane)") else { return }
    NSWorkspace.shared.open(url)
}

/**
 * Preflight TCC permission requests: prompt for each missing grant through the
 * macOS system dialog ("dsh-computer-daemon" would like to control / record),
 * and when macOS has already remembered a denial — so the dialog cannot
 * re-appear — open the matching System Settings pane instead, so the user never
 * navigates Settings manually. After the user grants Accessibility, the running
 * daemon picks it up immediately (TCC is checked dynamically); Screen Recording
 * may need a daemon restart on some macOS versions.
 */
@discardableResult
func requestPermissions() -> PermissionStatus {
    if !isBundled() {
        FileHandle.standardError.write(
            Data("dsh-computer-daemon: not running from its signed app bundle — macOS may attribute permission prompts to the parent process instead of this helper.\n".utf8)
        )
    }
    if !AXIsProcessTrusted() {
        let options: NSDictionary = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true,
        ]
        _ = AXIsProcessTrustedWithOptions(options)
        if !AXIsProcessTrusted() {
            openPrivacyPane("Privacy_Accessibility")
            FileHandle.standardError.write(
                Data("dsh-computer-daemon: Accessibility permission required — enable it in System Settings > Privacy & Security > Accessibility.\n".utf8)
            )
        }
    }
    if !CGPreflightScreenCaptureAccess() {
        _ = CGRequestScreenCaptureAccess()
        if !CGPreflightScreenCaptureAccess() {
            openPrivacyPane("Privacy_ScreenCapture")
            FileHandle.standardError.write(
                Data("dsh-computer-daemon: Screen Recording permission required — enable it in System Settings > Privacy & Security > Screen Recording.\n".utf8)
            )
        }
    }
    return currentPermissionStatus()
}
