import XCTest
@testable import dsh_computer_daemon

/** Pure-logic tests for the input layer: key-chord parsing and text anchoring. No input is synthesized here. */
final class InputTests: XCTestCase {

    func testChordParsesNamedKeysAndModifierAliases() throws {
        let chord = try KeyChord.parse("Control_L+a")
        XCTAssertEqual(chord.modifiers, [59])
        XCTAssertEqual(chord.keyCode, 0)
        XCTAssertNil(chord.character)

        let aliased = try KeyChord.parse("Ctrl+Shift+Return")
        XCTAssertEqual(aliased.modifiers, [59, 56])
        XCTAssertEqual(aliased.keyCode, 36)

        let command = try KeyChord.parse("Super_L+d")
        XCTAssertEqual(command.modifiers, [55])
        XCTAssertEqual(command.keyCode, 2)
    }

    func testChordParsesSingleCharactersAndNamedPunctuation() throws {
        let plain = try KeyChord.parse("a")
        XCTAssertEqual(plain.modifiers, [])
        XCTAssertEqual(plain.keyCode, 0)

        let digit = try KeyChord.parse("7")
        XCTAssertEqual(digit.keyCode, 26)

        let named = try KeyChord.parse("space")
        XCTAssertEqual(named.keyCode, 49)

        let escape = try KeyChord.parse("Escape")
        XCTAssertEqual(escape.keyCode, 53)

        let symbol = try KeyChord.parse("!")
        XCTAssertNil(symbol.keyCode)
        XCTAssertEqual(symbol.character, "!")
    }

    func testChordRejectsUnknownModifiersAndKeys() {
        XCTAssertThrowsError(try KeyChord.parse("Hyper+x"))
        XCTAssertThrowsError(try KeyChord.parse("notakey"))
        XCTAssertThrowsError(try KeyChord.parse(""))
    }

    func testFindTextLocatesWithAndWithoutAnchors() {
        let content = "the quick brown fox jumps over the quick dog"
        XCTAssertEqual(InputEngine.findText(in: content, text: "quick", prefix: nil, suffix: nil)?.location, 4)
        XCTAssertEqual(InputEngine.findText(in: content, text: "quick", prefix: "over the ", suffix: nil)?.location, 35)
        XCTAssertEqual(InputEngine.findText(in: content, text: "brown fox", prefix: "quick ", suffix: " jumps")?.location, 10)
        XCTAssertNil(InputEngine.findText(in: content, text: "absent", prefix: nil, suffix: nil))
        // An anchor that only matches together falls back to the plain match.
        XCTAssertEqual(InputEngine.findText(in: content, text: "quick", prefix: "nonexistent ", suffix: nil)?.location, 4)
    }

    func testTextStrategyPicksUnicodeEventsForPlainASCIIText() {
        XCTAssertEqual(InputEngine.textStrategy(appName: "TextEdit", bundleId: "com.apple.TextEdit", text: "hello"), .unicodeEvent)
        XCTAssertEqual(InputEngine.textStrategy(appName: "Brave Browser", bundleId: "com.brave.Browser", text: "youtube.com"), .unicodeEvent)
    }

    func testTextStrategyPicksPasteboardForNonASCIIAndCustomRenderedApps() {
        XCTAssertEqual(InputEngine.textStrategy(appName: "TextEdit", bundleId: "com.apple.TextEdit", text: "你好"), .pasteboard)
        XCTAssertEqual(InputEngine.textStrategy(appName: "Slack", bundleId: "com.tinyspeck.slackmacgap", text: "hi"), .pasteboard)
        XCTAssertEqual(InputEngine.textStrategy(appName: "Discord", bundleId: "com.hnc.Discord", text: "hi"), .pasteboard)
        XCTAssertEqual(InputEngine.textStrategy(appName: "Electron", bundleId: "com.example.electron", text: "hi"), .pasteboard)
    }

    func testConfigureForegroundAppsParsesTheCommaSeparatedEnvironment() {
        InputEngine.configureForegroundApps([:])
        XCTAssertTrue(InputEngine.foregroundApps.isEmpty)
        InputEngine.configureForegroundApps(["DSH_COMPUTER_FOREGROUND_APPS": " com.a.Brave ,com.b.App,  "])
        XCTAssertEqual(InputEngine.foregroundApps, ["com.a.Brave", "com.b.App"])
        InputEngine.configureForegroundApps(["DSH_COMPUTER_FOREGROUND_APPS": ""])
        XCTAssertTrue(InputEngine.foregroundApps.isEmpty)
    }
}
