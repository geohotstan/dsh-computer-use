import Foundation
import AppKit

/**
 * Best-effort focus-steal preventer: Chromium-family apps self-activate a few
 * frames after a background launch (their own `applicationDidFinishLaunching`
 * calls `activate`), which would flash the agent's dedicated browser over the
 * user's work. While a suppression entry is live, an activation matching the
 * entry immediately re-activates the app that was frontmost when suppression
 * began. The observer runs on its own background queue, so it fires without a
 * main run loop — the daemon's loop is synchronous. Ported from the
 * MIT-licensed trycua/cua project's `SystemFocusStealPreventer`
 * (Copyright (c) 2025 Cua AI, Inc.).
 */
final class FocusStealPreventer {

    /** One suppression entry: a launched pid to watch, the app to restore, and a bounded lifetime. */
    private struct Entry {
        let pid: pid_t
        let restoreTo: NSRunningApplication?
        let deadline: Date
    }

    static let shared = FocusStealPreventer()

    private let lock = NSLock()
    private var entries: [Entry] = []
    private var installed = false

    /**
     * Suppress activation flashes for the given pid for up to five seconds.
     * @param restoreTo - the app to hand the foreground back to; captured by
     *   the caller at launch time so a human-initiated switch afterwards wins.
     */
    func suppress(pid: pid_t, restoreTo: NSRunningApplication?) {
        lock.lock()
        defer { lock.unlock() }
        install()
        entries.append(Entry(pid: pid, restoreTo: restoreTo, deadline: Date().addingTimeInterval(5)))
    }

    private func install() {
        guard !installed else { return }
        installed = true
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: OperationQueue()
        ) { [weak self] note in
            self?.handleActivation(note)
        }
    }

    private func handleActivation(_ note: Notification) {
        guard let activated = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        let activatedPid = activated.processIdentifier
        lock.lock()
        let live = entries.filter { $0.deadline > Date() }
        entries = live
        let restoreTo = live.first { $0.pid == activatedPid }?.restoreTo
        lock.unlock()
        guard let restoreTo else { return }
        DispatchQueue.global().async {
            restoreTo.activate(options: [.activateAllWindows])
        }
    }
}
