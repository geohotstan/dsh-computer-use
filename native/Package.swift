// swift-tools-version: 5.10
// The resident macOS computer-use helper for @geohotstan/dsh-codex-computer-use/computer-local.
// Build: swift build -c release --package-path native
// then bundle+sign with scripts/bundle.sh (run `pnpm run build:native`). The
// signed app at native/.build/dsh-computer-daemon.app is the helperPath the TS
// engine spawns; the bundle identity is what makes macOS attribute its
// Accessibility and Screen Recording TCC prompts to this helper.
import PackageDescription

let package = Package(
    name: "dsh-computer-daemon",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "dsh-computer-daemon",
            path: "Sources/dsh-computer-daemon"
        ),
        .testTarget(
            name: "dsh-computer-daemon-tests",
            dependencies: ["dsh-computer-daemon"],
            path: "Tests/dsh-computer-daemon-tests"
        ),
    ]
)
