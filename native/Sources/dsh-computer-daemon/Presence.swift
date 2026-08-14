import Foundation
import AppKit
import CoreGraphics

/**
 * Presence layer: the borderless, click-transparent windows that make
 * computer use visible while it runs — the action banner (with the
 * Esc-to-cancel affordance), the lock-screen pause banner, and the software
 * cursor drawn at synthesized mouse positions. Esc detection polls the
 * physical key state, so it works while the daemon's synchronous loop is
 * sleeping between synthesized events and never needs a run loop.
 */
enum Presence {

    /** The virtual key code of Escape, the cancel affordance. */
    static let escKeyCode: CGKeyCode = 53

    private static var banner: NSWindow?
    private static var bannerText: NSTextField?
    private static var cursor: NSWindow?

    /** Whether the given key code is Escape (the pure classification the interrupt checks use). */
    static func isEscKeyCode(_ keyCode: CGKeyCode) -> Bool {
        keyCode == escKeyCode
    }

    /** Whether Escape is physically held right now. */
    static func isEscPressed() -> Bool {
        CGEventSource.keyState(.combinedSessionState, key: escKeyCode)
    }

    // MARK: - Banner

    /** Show (or retarget) the presence banner with one message; hidden with an empty message. */
    static func show(message: String) {
        if banner === nil {
            let width: CGFloat = 420
            let height: CGFloat = 44
            let screen = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            let frame = NSRect(
                x: screen.midX - width / 2,
                y: screen.maxY - height - 24,
                width: width,
                height: height
            )
            let window = NSWindow(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
            window.isOpaque = false
            window.backgroundColor = NSColor.black.withAlphaComponent(0.78)
            window.level = .screenSaver
            window.ignoresMouseEvents = true
            window.hasShadow = true
            let content = NSView(frame: NSRect(origin: .zero, size: frame.size))
            content.wantsLayer = true
            content.layer?.cornerRadius = 10
            content.layer?.masksToBounds = true
            let label = NSTextField(labelWithString: "")
            label.font = NSFont.systemFont(ofSize: 14, weight: .medium)
            label.textColor = .white
            label.alignment = .center
            label.frame = NSRect(x: 12, y: 0, width: width - 24, height: height)
            label.autoresizingMask = [.width]
            window.contentView = content
            content.addSubview(label)
            bannerText = label
            banner = window
        }
        bannerText?.stringValue = message
        banner?.orderFrontRegardless()
    }

    /** Hide the presence banner. */
    static func hide() {
        banner?.orderOut(nil)
    }

    // MARK: - Software cursor

    /** Draw the software cursor at a screen point; hidden by {@link hideCursor}. */
    static func moveCursor(to point: CGPoint) {
        let size = NSSize(width: 22, height: 30)
        if cursor === nil {
            let window = NSWindow(
                contentRect: NSRect(origin: point, size: size),
                styleMask: .borderless,
                backing: .buffered,
                defer: false
            )
            window.isOpaque = false
            window.backgroundColor = .clear
            window.level = .screenSaver
            window.ignoresMouseEvents = true
            window.hasShadow = false
            let view = CursorView(frame: NSRect(origin: .zero, size: size))
            window.contentView = view
            cursor = window
        }
        cursor?.setFrameOrigin(point)
        cursor?.orderFrontRegardless()
    }

    /** Hide the software cursor. */
    static func hideCursor() {
        cursor?.orderOut(nil)
    }
}

/** The arrow shape drawn for the software cursor. */
final class CursorView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let path = NSBezierPath()
        path.move(to: NSPoint(x: 1, y: bounds.height - 3))
        path.line(to: NSPoint(x: 1, y: 6))
        path.line(to: NSPoint(x: 8, y: 13))
        path.line(to: NSPoint(x: 11, y: 12))
        path.line(to: NSPoint(x: 14, y: 18))
        path.line(to: NSPoint(x: 17, y: 16))
        path.line(to: NSPoint(x: 14, y: 10))
        path.line(to: NSPoint(x: 20, y: 11))
        path.close()
        NSColor.white.setFill()
        path.fill()
        NSColor.black.setStroke()
        path.lineWidth = 1
        path.stroke()
    }
}
