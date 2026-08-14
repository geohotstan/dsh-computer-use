import XCTest
import CoreGraphics
@testable import dsh_computer_daemon

/** Pure-logic recorder tests: the event summarization the journal writes. */
final class RecorderTests: XCTestCase {

    func testSummarizeClassifiesKeyAndMouseEvents() {
        guard let key = CGEvent(keyboardEventSource: nil, virtualKey: 36, keyDown: true) else {
            return XCTFail("could not create key event")
        }
        let keySummary = Recorder.summarize(event: key, type: .keyDown, time: 0.5)
        XCTAssertEqual(keySummary?.kind, "keyDown")
        XCTAssertEqual(keySummary?.keyCode, 36)
        XCTAssertEqual(keySummary?.time, 0.5)
        XCTAssertNil(keySummary?.point)

        guard let mouse = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: CGPoint(x: 3, y: 4), mouseButton: .left) else {
            return XCTFail("could not create mouse event")
        }
        let mouseSummary = Recorder.summarize(event: mouse, type: .leftMouseDown, time: 1.25)
        XCTAssertEqual(mouseSummary?.kind, "leftMouseDown")
        XCTAssertEqual(mouseSummary?.point ?? [], [3, 4])
        XCTAssertEqual(mouseSummary?.time, 1.25)

        XCTAssertNil(Recorder.summarize(event: key, type: .tapDisabledByTimeout))
    }
}
