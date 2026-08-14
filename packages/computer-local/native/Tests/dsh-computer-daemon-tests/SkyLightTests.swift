import XCTest
@testable import dsh_computer_daemon

/** Pure-logic tests for the SkyLight bridge: record layout and browser isolation classification. No private API is invoked. */
final class SkyLightTests: XCTestCase {

    func testFocusRecordLayout() {
        let record = SkyLight.focusRecord(windowId: 0x1234_5678, focus: true)
        XCTAssertEqual(record.count, 0xF8)
        XCTAssertEqual(record[0x04], 0xF8)
        XCTAssertEqual(record[0x08], 0x0D)
        // Window id little-endian at 0x3c–0x3f.
        XCTAssertEqual(record[0x3C], 0x78)
        XCTAssertEqual(record[0x3D], 0x56)
        XCTAssertEqual(record[0x3E], 0x34)
        XCTAssertEqual(record[0x3F], 0x12)
        XCTAssertEqual(record[0x8A], 0x01)

        let defocus = SkyLight.focusRecord(windowId: 1, focus: false)
        XCTAssertEqual(defocus[0x8A], 0x02)
        XCTAssertEqual(defocus[0x3C], 0x01)
        XCTAssertEqual(defocus[0x3D], 0x00)
    }

    func testFocusRecordIsZeroElsewhere() {
        let record = SkyLight.focusRecord(windowId: 0xFFFF_FFFF, focus: true)
        let stamped = Set([0x04, 0x08, 0x3C, 0x3D, 0x3E, 0x3F, 0x8A])
        for (index, byte) in record.enumerated() where !stamped.contains(index) {
            XCTAssertEqual(byte, 0, "byte \(index) must be zero")
        }
    }

    func testBrowserIsolationClassifiesBundlesAndNames() {
        XCTAssertTrue(CaptureSession.isIsolatableBrowserForTesting("com.brave.Browser"))
        XCTAssertTrue(CaptureSession.isIsolatableBrowserForTesting("Brave Browser"))
        XCTAssertTrue(CaptureSession.isIsolatableBrowserForTesting("org.chromium.Chromium"))
        XCTAssertFalse(CaptureSession.isIsolatableBrowserForTesting("com.apple.Safari"))
        XCTAssertFalse(CaptureSession.isIsolatableBrowserForTesting("TextEdit"))
    }

    func testBrowserIsolationParsesEnvironment() {
        CaptureSession.configureBrowserIsolation([:])
        XCTAssertFalse(CaptureSession.browserIsolationEnabled)
        CaptureSession.configureBrowserIsolation(["DSH_COMPUTER_BROWSER_ISOLATION": "1"])
        XCTAssertTrue(CaptureSession.browserIsolationEnabled)
        CaptureSession.configureBrowserIsolation(["DSH_COMPUTER_BROWSER_ISOLATION": "true"])
        XCTAssertTrue(CaptureSession.browserIsolationEnabled)
        CaptureSession.configureBrowserIsolation(["DSH_COMPUTER_BROWSER_ISOLATION": "0"])
        XCTAssertFalse(CaptureSession.browserIsolationEnabled)
    }
}
