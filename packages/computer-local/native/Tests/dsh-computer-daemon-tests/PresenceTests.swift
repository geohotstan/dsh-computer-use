import XCTest
@testable import dsh_computer_daemon

/** Pure-logic presence tests: the Esc keycode classification the interrupt checks use. */
final class PresenceTests: XCTestCase {

    func testEscKeyCodeClassification() {
        XCTAssertTrue(Presence.isEscKeyCode(53))
        XCTAssertFalse(Presence.isEscKeyCode(36))
        XCTAssertFalse(Presence.isEscKeyCode(0))
    }
}
