import XCTest
@testable import dsh_computer_daemon

/** Pure-logic test for the .app bundle identity that TCC attribution depends on. No TCC APIs run here. */
final class PermissionTests: XCTestCase {

    func testDaemonBundleIdentityMatchesOnlyTheSignedApp() {
        XCTAssertTrue(hasDaemonBundleIdentity("com.deepseek-ai.dsh-computer-daemon"))
        XCTAssertFalse(hasDaemonBundleIdentity(nil))
        XCTAssertFalse(hasDaemonBundleIdentity("com.apple.Terminal"))
        XCTAssertFalse(hasDaemonBundleIdentity(""))
    }
}
