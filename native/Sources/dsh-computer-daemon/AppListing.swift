import Foundation
import AppKit
import CoreServices

/**
 * App discovery for the `list_apps` method, matching the official computer-use
 * surface: the running apps plus every app used in the last 14 days, ordered
 * by Spotlight usage frequency. Usage comes from the same Spotlight metadata
 * the official implementation reads — `kMDItemUseCount` and
 * `kMDItemLastUsedDate` of each installed bundle — with the running set from
 * `NSWorkspace` (authoritative for `isRunning`) merged on top.
 */
enum AppListing {

    /** The usage window: apps last used outside it are not listed unless running. */
    static let usageWindowDays = 14

    /** Spotlight attribute names for app usage (Metadata.h constants by their stable string form). */
    private static let useCountAttribute = "kMDItemUseCount" as CFString
    private static let lastUsedDateAttribute = "kMDItemLastUsedDate" as CFString

    static func listApps(order: String?) -> [[String: Any]] {
        var byId: [String: [String: Any]] = [:]

        // Running apps are authoritative for the canonical id and the
        // isRunning flag; they also surface apps with no Spotlight index.
        let running = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular }
        for app in running {
            guard let id = app.bundleIdentifier, !id.isEmpty else { continue }
            byId[id] = [
                "id": id,
                "isRunning": true,
                "displayName": app.localizedName
                    ?? app.bundleURL?.deletingPathExtension().lastPathComponent
                    ?? id,
            ]
        }

        // Installed bundles with recent usage fill the rest of the list, and
        // annotate the running entries with their usage metadata.
        for (id, name, uses, lastUsed) in installedAppUsage() {
            if byId[id] == nil, let lastUsed {
                byId[id] = ["id": id, "displayName": name, "lastUsedDate": lastUsed]
            }
            if var entry = byId[id] {
                if entry["useCount"] == nil, let uses { entry["useCount"] = uses }
                if entry["lastUsedDate"] == nil, let lastUsed { entry["lastUsedDate"] = lastUsed }
                byId[id] = entry
            }
        }

        let apps = Array(byId.values)
        switch order {
        case "display-name":
            return apps.sorted {
                let left = $0["displayName"] as? String ?? ($0["id"] as? String ?? "")
                let right = $1["displayName"] as? String ?? ($1["id"] as? String ?? "")
                return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
            }
        default:
            // Usage ranking first (Spotlight use counts), then display name.
            return apps.sorted {
                let leftUses = $0["useCount"] as? Int ?? 0
                let rightUses = $1["useCount"] as? Int ?? 0
                if leftUses != rightUses { return leftUses > rightUses }
                let left = $0["displayName"] as? String ?? ""
                let right = $1["displayName"] as? String ?? ""
                return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
            }
        }
    }

    /** Usage metadata per installed bundle: (bundle id, display name, use count, last-used date). */
    private static func installedAppUsage() -> [(String, String, Int?, String?)] {
        let cutoff = Date().addingTimeInterval(-Double(usageWindowDays) * 24 * 60 * 60)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current

        var results: [(String, String, Int?, String?)] = []
        // One global Spotlight query over every application bundle, like the
        // official surface: apps used recently surface wherever they live,
        // not only under the standard Applications folders.
        for path in runMdfind() {
            guard path.hasSuffix(".app"), let bundle = Bundle(path: path),
                  let id = bundle.bundleIdentifier, !id.isEmpty
            else { continue }
            let name = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
                ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
                ?? URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
            let url = URL(fileURLWithPath: path) as CFURL
            guard let item = MDItemCreateWithURL(kCFAllocatorDefault, url) else {
                results.append((id, name, nil, nil))
                continue
            }
            let uses = MDItemCopyAttribute(item, useCountAttribute) as? Int
            let lastUsed: String?
            if let date = MDItemCopyAttribute(item, lastUsedDateAttribute) as? Date, date >= cutoff {
                lastUsed = formatter.string(from: date)
            } else {
                lastUsed = nil
            }
            results.append((id, name, uses, lastUsed))
        }
        return results
    }

    /** Run one bounded mdfind query and return its newline-separated paths. */
    private static func runMdfind() -> [String] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/mdfind")
        process.arguments = [
            "kMDItemContentType == 'com.apple.application-bundle'",
        ]
        let pipe = Pipe()
        process.standardOutput = pipe
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            return []
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let output = String(data: data, encoding: .utf8) else { return [] }
        return output.split(separator: "\n").map(String.init)
    }
}
