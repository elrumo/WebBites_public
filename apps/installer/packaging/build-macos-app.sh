#!/bin/sh
# Builds "WebBites Server.app" (universal: Apple Silicon and Intel) and zips it. Runs on macOS.
#
#   packaging/build-macos-app.sh <version> <output-dir>
#
# Signing: with DEVELOPER_ID set (e.g. "Developer ID Application: Name (TEAMID)") and the certificate
# in the keychain, the app is signed with it (hardened runtime) and, with NOTARY_PROFILE set (a
# `xcrun notarytool store-credentials` profile), notarized and stapled. Without, it is ad-hoc signed:
# it runs, but the first launch needs System Settings > Privacy & Security > Open Anyway.
# KEYCHAIN=<path> says which keychain holds the certificate (and the notary profile) when it is not
# in the default search list, for example a dedicated, unlocked signing keychain.
set -eu
VERSION="${1:?version}"
OUT="${2:?output dir}"
cd "$(dirname "$0")/.."
mkdir -p "$OUT"
WORK="$(mktemp -d)"
APP="$WORK/WebBites Server.app"

for arch in arm64 amd64; do
  CGO_ENABLED=1 GOOS=darwin GOARCH=$arch go build -trimpath -ldflags "-s -w -X main.appVersion=$VERSION" -o "$WORK/webbites-server-$arch" .
done
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
lipo -create -output "$APP/Contents/MacOS/webbites-server" "$WORK/webbites-server-arm64" "$WORK/webbites-server-amd64"
sed "s/__VERSION__/$VERSION/g" packaging/Info.plist > "$APP/Contents/Info.plist"

# The icon, from the 1024 px PNG.
ICONSET="$WORK/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s icons/app-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) icons/app-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

if [ -n "${DEVELOPER_ID:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID" ${KEYCHAIN:+--keychain "$KEYCHAIN"} "$APP"
else
  codesign --force --sign - "$APP"
fi

ZIP="$OUT/WebBites-Server-macOS.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
if [ -n "${DEVELOPER_ID:-}" ] && [ -n "${NOTARY_PROFILE:-}" ]; then
  xcrun notarytool submit "$ZIP" --keychain-profile "$NOTARY_PROFILE" ${KEYCHAIN:+--keychain "$KEYCHAIN"} --wait
  xcrun stapler staple "$APP"
  rm "$ZIP" && ditto -c -k --keepParent "$APP" "$ZIP"
fi
echo "$ZIP"
