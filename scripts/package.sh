#!/usr/bin/env bash
# One-shot: build a deno-desktop (laufey/CEF) app, sign it with a Developer ID
# + hardened runtime, pack it into a .dmg, notarize, and staple — producing a
# distributable, double-clickable .dmg.
#
#   ./scripts/package.sh
#
# Reusable for new apps: run from the app's project root, or override the vars
# below via the environment. Set NOTARIZE=0 to stop after signing.
set -euo pipefail
cd "$(dirname "$0")/.."

# --- config (override via env) ---
APP_NAME="${APP_NAME:-$(basename "$PWD")}"
SIGN_ID="${SIGN_ID:-Developer ID Application: Deno Land Inc. (2H4KBF436B)}"
DENO_BIN="${DENO_BIN:-/Users/divy/gh/deno/target/debug/deno}"
WEF_DEV_DIR="${WEF_DEV_DIR:-/Users/divy/gh/just-wef}"          # laufey checkout
DENORT_DESKTOP_BIN="${DENORT_DESKTOP_BIN:-/Users/divy/gh/deno/target/debug/libdenort.dylib}"
ICON="${ICON:-static/icon.icns}"
ENTITLEMENTS="${ENTITLEMENTS:-$(cd "$(dirname "$0")" && pwd)/entitlements.plist}"
DESKTOP_TITLEBAR="${DESKTOP_TITLEBAR:-hidden}"                 # "" to skip
NOTARY_KEY_JSON="${NOTARY_KEY_JSON:-$HOME/Downloads/notarize-key.json}"  # {key_id, issuer_id, private_key}
NOTARIZE="${NOTARIZE:-1}"

APP="$APP_NAME.app"; DMG="$APP_NAME.dmg"; PB=/usr/libexec/PlistBuddy
sign() { codesign --force --timestamp --options runtime "$@"; }

echo "==> build web bundle"
deno task build

echo "==> package desktop app ($APP)"
rm -rf "$APP" "$DMG"
rm -rf "$WEF_DEV_DIR/cef/build/Release/laufey.app/Contents/MacOS/.laufey"* 2>/dev/null || true
DENORT_DESKTOP_BIN="$DENORT_DESKTOP_BIN" WEF_DEV_DIR="$WEF_DEV_DIR" \
  "$DENO_BIN" desktop -A --output "$APP_NAME" --icon "$ICON" .

if [ -n "$DESKTOP_TITLEBAR" ]; then
  echo "==> bake DENO_DESKTOP_TITLEBAR=$DESKTOP_TITLEBAR"
  $PB -c "Add :LSEnvironment dict" "$APP/Contents/Info.plist" 2>/dev/null || true
  $PB -c "Add :LSEnvironment:DENO_DESKTOP_TITLEBAR string $DESKTOP_TITLEBAR" "$APP/Contents/Info.plist" 2>/dev/null \
    || $PB -c "Set :LSEnvironment:DENO_DESKTOP_TITLEBAR $DESKTOP_TITLEBAR" "$APP/Contents/Info.plist"
fi

echo "==> sign inside-out (Developer ID, hardened runtime)"
FW="$APP/Contents/Frameworks/Chromium Embedded Framework.framework"
if [ -d "$FW" ]; then
  for d in "$FW/Libraries/"*.dylib; do [ -e "$d" ] && sign -s "$SIGN_ID" "$d"; done
  sign -s "$SIGN_ID" "$FW/Versions/A/Chromium Embedded Framework"
fi
for H in "$APP/Contents/Frameworks/"*.app; do [ -e "$H" ] && sign --entitlements "$ENTITLEMENTS" -s "$SIGN_ID" "$H"; done
for f in "$APP/Contents/MacOS/"*; do
  case "$(file -b "$f")" in
    *Mach-O*library*)    sign -s "$SIGN_ID" "$f" ;;                          # runtime dylib
    *Mach-O*executable*) sign --entitlements "$ENTITLEMENTS" -s "$SIGN_ID" "$f" ;;  # laufey/CEF host
  esac                                                                       # launcher script: sealed below
done
sign --entitlements "$ENTITLEMENTS" -s "$SIGN_ID" "$APP"
codesign --verify --deep --strict "$APP"

echo "==> build + sign dmg"
STAGE="$(mktemp -d)"
cp -Rc "$APP" "$STAGE/$APP"          # APFS clonefile — no extra disk
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
rm -rf "$STAGE"
sign -s "$SIGN_ID" "$DMG"

if [ "$NOTARIZE" = 1 ]; then
  echo "==> notarize ($DMG) — waits for Apple"
  KEY="$(mktemp /tmp/notary.XXXXXX.p8)"
  trap 'rm -f "$KEY"' EXIT
  creds=$(python3 - "$NOTARY_KEY_JSON" "$KEY" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); pk=d["private_key"].strip()
if "-----BEGIN" not in pk:
    pk="-----BEGIN PRIVATE KEY-----\n"+"\n".join(pk[i:i+64] for i in range(0,len(pk),64))+"\n-----END PRIVATE KEY-----\n"
open(sys.argv[2],"w").write(pk)
print(d["key_id"], d["issuer_id"])
PY
)
  KID="${creds% *}"; ISS="${creds#* }"
  xcrun notarytool submit "$DMG" --key "$KEY" --key-id "$KID" --issuer "$ISS" --wait
  echo "==> staple"
  xcrun stapler staple "$DMG"
  xcrun stapler staple "$APP"   # also staple the standalone app (offline-friendly)
fi

echo "==> done: $(pwd)/$DMG"
spctl -a -t open --context context:primary-signature -vv "$DMG" 2>&1 | head -2 || true
ls -lh "$DMG" | awk '{print $5, $9}'
