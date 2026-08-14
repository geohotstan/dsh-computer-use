#!/usr/bin/env bash
# Bundle the release dsh-computer-daemon binary into a signed .app so macOS
# TCC attributes its Accessibility and Screen Recording prompts to this helper
# (its own bundle id + code signature) instead of the responsible parent —
# typically the terminal hosting the Node harness. TCC keys a grant on the
# bundle id, the code signature, and the on-disk path: keep the checkout at a
# fixed path, and sign with a stable identity (see the README) or macOS forgets
# the grants on every rebuild.
set -euo pipefail

APP_ID="com.deepseek-ai.dsh-computer-daemon"
APP_NAME="dsh-computer-daemon"
VERSION="${DSH_COMPUTER_VERSION:-0.1.0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$(dirname "$SCRIPT_DIR")"
BIN="$NATIVE_DIR/.build/release/$APP_NAME"
APP="$NATIVE_DIR/.build/$APP_NAME.app"
CONTENTS="$APP/Contents"

if [[ ! -x "$BIN" ]]; then
  echo "dsh-computer-daemon: $BIN not found — run 'swift build -c release --package-path $NATIVE_DIR' first" >&2
  exit 1
fi

rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS"
cp "$BIN" "$CONTENTS/MacOS/$APP_NAME"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>DeepSeek Harness Computer Use</string>
	<key>CFBundleExecutable</key>
	<string>$APP_NAME</string>
	<key>CFBundleIdentifier</key>
	<string>$APP_ID</string>
	<key>CFBundleName</key>
	<string>$APP_NAME</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>$VERSION</string>
	<key>CFBundleVersion</key>
	<string>$VERSION</string>
	<key>LSBackgroundOnly</key>
	<true/>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

plutil -lint "$CONTENTS/Info.plist" >/dev/null

IDENTITY="${DSH_COMPUTER_SIGN_IDENTITY:--}"
if [[ "$IDENTITY" == "-" ]]; then
  echo "dsh-computer-daemon: ad-hoc signing — macOS forgets TCC grants on every rebuild." >&2
  echo "dsh-computer-daemon: set DSH_COMPUTER_SIGN_IDENTITY to a stable code-signing certificate for persistent grants." >&2
fi
codesign --force --sign "$IDENTITY" --identifier "$APP_ID" "$APP"
codesign --verify --strict "$APP"

echo "bundled: $APP"
echo "helperPath: $CONTENTS/MacOS/$APP_NAME"
codesign -d -r- "$APP" 2>&1 | grep -E 'Identifier=|Designated Requirement|designated =>' | sed 's/^/signature: /' || true
