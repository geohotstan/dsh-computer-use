import Foundation
import AppKit

/**
 * Codex-style safety denylist: apps the deployment refuses to drive. Bundle
 * ids passed directly receive an explicit safety denial; name-based lookup
 * deliberately does not resolve to these apps, so a human-readable name
 * yields `appNotFound` instead. The list covers the categories the official
 * surface denies — terminals, password managers, the system authentication
 * surfaces — plus a dynamic check for security processes (see
 * {@link isSystemSecurityProcess}).
 */
enum SafetyPolicy {

    /** Bundle ids that computer use refuses to target. */
    static let deniedBundleIds: Set<String> = [
        // Terminals — automating them could bypass the harness's own shell policy.
        "com.googlecode.iterm2",
        "com.apple.Terminal",
        "net.kovidgoyal.kitty",
        "org.alacritty",
        "co.zeit.hyper",
        "dev.warp.Warp-Stable",
        "org.wezfurlong.wezterm",
        "com.mitchellh.ghostty",
        "com.raphaelamorim.rio",
        "dev.commandline.waveterm",
        // Password managers — never drive credential surfaces.
        "com.1password.1password",
        "com.1password.safari",
        "com.agilebits.onepassword7",
        "com.apple.keychainaccess",
        "com.bitwarden.desktop",
        "com.lastpass.lastpass",
        "com.dashlane.dashlanephonefinal",
        "com.nordsec.nordpass",
        "me.proton.pass.electron",
        "me.proton.pass.catalyst",
        // System authentication and notification surfaces.
        "com.apple.SecurityAgent",
        "com.apple.LocalAuthenticationRemoteService",
        "com.apple.UserNotificationCenter",
    ]

    /** Lowercase name fragments that keep name-based resolution from targeting an app. */
    static let deniedNameMarkers: [String] = [
        "iterm", "terminal", "warp", "ghostty", "kitty", "alacritty", "wezterm", "hyper",
        "1password", "bitwarden", "lastpass", "dashlane", "keychain", "nordpass",
        "proton pass", "waveterm",
    ]

    /** Whether a bundle id is denied outright (case-insensitive, like Launch Services). */
    static func isDenied(bundleId: String) -> Bool {
        let normalized = bundleId.lowercased()
        return deniedBundleIds.contains { $0.lowercased() == normalized }
    }

    // MARK: - Deployment organization policy

    /** Canonical app ids the deployment blocks (env `DSH_COMPUTER_DENIED_APPS`, comma-separated). */
    static var configuredDeniedApps: Set<String> = []

    /** Read the deployment's organization-policy deny set from the daemon's environment. */
    static func configureDeniedApps(_ environment: [String: String]) {
        let raw = environment["DSH_COMPUTER_DENIED_APPS"] ?? ""
        configuredDeniedApps = Set(
            raw.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                .filter { !$0.isEmpty }
        )
    }

    /** Whether the deployment's organization policy blocks a bundle id. */
    static func isConfiguredDenied(bundleId: String) -> Bool {
        configuredDeniedApps.contains(bundleId.lowercased())
    }

    /** Whether a human-readable name must not resolve to a target app. */
    static func isDenied(name: String) -> Bool {
        let normalized = name.lowercased()
        return deniedNameMarkers.contains { normalized.contains($0) }
    }

    /**
     * Whether a running application is a system security process: its
     * executable lives in a system framework or service location, outside any
     * application bundle the user could open. The official surface refuses
     * these with a dedicated message; targeting them would otherwise reach
     * authentication and notification plumbing through name matches.
     */
    static func isSystemSecurityProcess(_ running: NSRunningApplication) -> Bool {
        guard let path = running.executableURL?.path else { return running.bundleIdentifier == nil }
        return path.hasPrefix("/System/Library/PrivateFrameworks/")
            || path.hasPrefix("/System/Library/Frameworks/")
            || path.hasPrefix("/usr/libexec/")
    }

    // MARK: - Browser private windows

    /**
     * Lowercase window-title fragments that identify a browser private or
     * incognito window, across the locales the browser vendors localize.
     * Browser apps are still targetable; a capture or action is refused only
     * while the key window matches one of these.
     */
    static let privateWindowTitleMarkers: [String] = [
        // English and vendor-specific forms.
        "(incognito)", "incognito tab", "incognito window", "new incognito",
        "inprivate", "private browsing", "private window", "(private)",
        // European locales.
        "(anonymní)", "anonymní režim", "anonymné prezeranie",
        "(inkognitó mód)", "inkognitó mód", "inkognito režīms", "(inkognito)",
        "navegação anónima", "navegação anônima", "navegação privada",
        "navigation privée", "navegación privada", "(incógnito)",
        "navigazione anonima", "(anonima)", "privat surfen", "(privat)",
        "prywatne", "gizli mod", "(gizli)", "brez beleženja zgodovine",
        "ανώνυμη περιήγηση", "privé",
        // Cyrillic.
        "режим инкогнито", "инкогнито", "приватное окно", "анонимный просмотр",
        "анонімний перегляд", "інкогніто", "приватне вікно",
        // CJK.
        "隐身", "无痕", "隐私浏览", "シークレット", "プライベート", "시크릿 모드", "시크릿",
        // RTL and Indic.
        "גלישה בסתר", "מצב עילום", "التصفح المتخفي", "تصفح مخفي",
        "ناشناس", "پنهان", "निजी", "गुप्त", "প্রাইভেট", "மறை நிலை",
        // Southeast Asian.
        "ẩn danh", "penyamaran", "samaran", "ส่วนตัว",
    ]

    /** Whether a browser window title belongs to a private or incognito window. */
    static func isPrivateWindowTitle(_ title: String) -> Bool {
        let normalized = title.lowercased()
        return privateWindowTitleMarkers.contains { normalized.contains($0) }
    }
}
