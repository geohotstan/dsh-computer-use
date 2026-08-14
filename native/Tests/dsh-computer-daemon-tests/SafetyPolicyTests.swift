import XCTest
@testable import dsh_computer_daemon

/** Pure-logic safety tests: the browser private-window title matcher. No AX or screen APIs run here. */
final class SafetyPolicyTests: XCTestCase {

    func testPrivateWindowTitlesMatchAcrossLocales() {
        for title in [
            "New Incognito Tab - Google Chrome",
            "(Incognito) - Brave",
            "InPrivate - Microsoft Edge",
            "Private Browsing - Firefox",
            "(Navigation privée) - Safari",
            "(Navegação privada) - Opera",
            "(режим инкогнито) - Yandex",
            "(无痕浏览) - Chrome",
            "(시크릿 모드) - Chrome",
            "(التصفح المتخفي) - Chrome",
            "(brez beleženja zgodovine) - Firefox",
        ] {
            XCTAssertTrue(SafetyPolicy.isPrivateWindowTitle(title), title)
        }
    }

    func testOrdinaryTitlesDoNotMatch() {
        for title in [
            "Home / X",
            "Incognito mode explained - Google Chrome",
            "Privacy film review - Safari",
            "Aide Safari - Safari",
            "youtube.com",
        ] {
            XCTAssertFalse(SafetyPolicy.isPrivateWindowTitle(title), title)
        }
    }

    func testConfiguredDenySetMatchesCaseInsensitively() {
        SafetyPolicy.configureDeniedApps(["DSH_COMPUTER_DENIED_APPS": "com.example.Blocked, org.other.app"])
        XCTAssertTrue(SafetyPolicy.isConfiguredDenied(bundleId: "com.example.blocked"))
        XCTAssertTrue(SafetyPolicy.isConfiguredDenied(bundleId: "org.other.app"))
        XCTAssertFalse(SafetyPolicy.isConfiguredDenied(bundleId: "com.example.ok"))
        SafetyPolicy.configureDeniedApps([:])
        XCTAssertFalse(SafetyPolicy.isConfiguredDenied(bundleId: "com.example.blocked"))
    }
}
