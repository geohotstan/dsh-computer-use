import XCTest
@testable import dsh_computer_daemon

/** Pure-logic tests for the deployment browser-URL policy. */
final class UrlPolicyTests: XCTestCase {

    override func setUp() {
        UrlPolicy.configure([:])
    }

    func testEverythingAllowedWithoutPolicy() {
        XCTAssertTrue(UrlPolicy.isAllowed("https://x.com/home"))
        XCTAssertTrue(UrlPolicy.isAllowed("file:///tmp/a"))
    }

    func testAllowListRestrictsToPrefixes() {
        UrlPolicy.configure(["DSH_COMPUTER_URL_ALLOW": "https://x.com, https://docs.google.com"])
        XCTAssertTrue(UrlPolicy.isAllowed("https://x.com/home"))
        XCTAssertTrue(UrlPolicy.isAllowed("https://docs.google.com/document/d/1"))
        XCTAssertFalse(UrlPolicy.isAllowed("https://news.ycombinator.com"))
    }

    func testDenyWinsOverAllow() {
        UrlPolicy.configure(["DSH_COMPUTER_URL_ALLOW": "https://x.com", "DSH_COMPUTER_URL_DENY": "https://x.com/settings"])
        XCTAssertTrue(UrlPolicy.isAllowed("https://x.com/home"))
        XCTAssertFalse(UrlPolicy.isAllowed("https://x.com/settings/account"))
    }

    func testParsingTrimsAndLowercases() {
        UrlPolicy.configure(["DSH_COMPUTER_URL_ALLOW": "  HTTPS://X.COM ,, https://Docs.Google.com "])
        XCTAssertTrue(UrlPolicy.isAllowed("https://x.com/home"))
        XCTAssertTrue(UrlPolicy.isAllowed("https://docs.google.com/x"))
        XCTAssertFalse(UrlPolicy.isAllowed("https://other.com"))
    }
}
