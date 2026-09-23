#!/bin/bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  cat <<'HELP'
Usage: npm run package:mac

Build, sign, and verify a DMG for the current Mac's architecture.
Requires npm dependencies, Xcode command line tools, and a Developer ID certificate.

Optional environment variables:
  MAC_SIGN_IDENTITY  Full Developer ID Application certificate name.
                    Automatically selected when exactly one certificate is available.
  NOTARY_PROFILE    Existing notarytool keychain profile; enables Apple notarization.

Artifacts are saved in a unique directory under release/.
HELP
  exit 0
fi
if [[ $# -ne 0 ]]; then
  echo "Unknown arguments. Use --help for usage." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin ]] || { echo "This workflow requires macOS." >&2; exit 1; }
for tool in node npm security codesign hdiutil ditto xcrun; do
  command -v "$tool" >/dev/null || { echo "Missing tool: $tool" >&2; exit 1; }
done
[[ -x node_modules/.bin/electron-builder ]] || { echo "Run npm ci first." >&2; exit 1; }

arch="$(node -p 'process.arch')"
case "$arch" in
  arm64) macho_arch=arm64 ;;
  x64) macho_arch=x86_64 ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac
runtime="node_modules/electron/dist"
electron_version="$(node -p 'require("./node_modules/electron/package.json").version')"
[[ "$(cat "$runtime/version")" == "$electron_version" ]] || { echo "Electron runtime version mismatch; run npm ci." >&2; exit 1; }
xcrun lipo "$runtime/Electron.app/Contents/MacOS/Electron" -verify_arch "$macho_arch"

identities="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p')"
identity="${MAC_SIGN_IDENTITY:-}"
if [[ -z "$identity" ]]; then
  [[ -n "$identities" && "$(printf '%s\n' "$identities" | wc -l | tr -d ' ')" == 1 ]] || {
    echo "Set MAC_SIGN_IDENTITY to one available Developer ID Application certificate:" >&2
    printf '%s\n' "$identities" >&2
    exit 1
  }
  identity="$identities"
fi
printf '%s\n' "$identities" | grep -Fx -- "$identity" >/dev/null || { echo "Signing certificate is not available: $identity" >&2; exit 1; }
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null
fi

version="$(node -p 'require("./package.json").version')"
mkdir -p release
output="$(mktemp -d "$PWD/release/macos-${version}-${arch}-XXXXXX")"
staging="$(mktemp -d "$output/staging-XXXXXX")"
mountpoint="$output/mount"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then hdiutil detach "$mountpoint" || true; fi
  rm -rf "$staging"
  rmdir "$mountpoint" 2>/dev/null || true
}
trap cleanup EXIT

echo "Building $version ($arch), signing with $identity"
npm run build:mac -- --dir "--$arch" --publish never \
  "-c.electronDist=$runtime" "-c.mac.identity=${identity#Developer ID Application: }" \
  -c.mac.notarize=false "-c.directories.output=$output"
app="$output/mac-$arch/Recordly.app"
if [[ "$arch" == x64 ]]; then app="$output/mac/Recordly.app"; fi
codesign --verify --deep --strict "$app"
codesign --display --verbose=4 "$app"
node scripts/smoke-packaged-cli.mjs "$app"

notary_status="Not notarized (NOTARY_PROFILE was not set)"
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  ditto -c -k --keepParent "$app" "$output/notarization.zip"
  xcrun notarytool submit "$output/notarization.zip" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$app"
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=2 "$app"
  rm "$output/notarization.zip"
  notary_status="Notarized and stapled"
fi

ditto "$app" "$staging/Recordly.app"
ln -s /Applications "$staging/Applications"
dmg="$output/Recordly-${version}-${arch}.dmg"
hdiutil create -volname Recordly -srcfolder "$staging" -format UDZO "$dmg"
codesign --sign "$identity" --timestamp "$dmg"
if [[ -n "${NOTARY_PROFILE:-}" ]]; then
  xcrun notarytool submit "$dmg" --keychain-profile "$NOTARY_PROFILE" --wait
  xcrun stapler staple "$dmg"
  xcrun stapler validate "$dmg"
fi
codesign --verify --verbose=2 "$dmg"
hdiutil verify "$dmg"
mkdir "$mountpoint"
hdiutil attach -readonly -nobrowse -mountpoint "$mountpoint" "$dmg"
mounted=true
codesign --verify --deep --strict "$mountpoint/Recordly.app"
[[ "$(readlink "$mountpoint/Applications")" == /Applications ]]
hdiutil detach "$mountpoint"
mounted=false
(cd "$output" && shasum -a 256 "$(basename "$dmg")" > "$(basename "$dmg").sha256")
printf 'Version: %s\nArchitecture: %s\nCertificate: %s\nNotarization: %s\nVerification: installed CLI smoke tests, application signature, DMG signature, checksum and mounted contents passed\n' \
  "$version" "$arch" "$identity" "$notary_status" > "$output/packaging-report.txt"
printf '\nDMG: %s\n%s\n' "$dmg" "$notary_status"
