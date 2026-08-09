#!/usr/bin/env bash

set -euo pipefail

fail() {
  echo "::error::$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required macOS release tool is unavailable: $1"
}

for command_name in codesign ditto grep hdiutil node spctl xcrun; do
  require_command "$command_name"
done

: "${EXPECTED_APPLE_TEAM_ID:?EXPECTED_APPLE_TEAM_ID is required}"
: "${MACOS_BUILD_MARKER:?MACOS_BUILD_MARKER is required}"

if [[ ! "$EXPECTED_APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]; then
  fail "EXPECTED_APPLE_TEAM_ID must be a 10-character Apple Developer Team ID"
fi

if [[ ! -f "$MACOS_BUILD_MARKER" ]]; then
  fail "macOS build marker is missing: $MACOS_BUILD_MARKER"
fi

app_version="$(node -p "require('./app/package.json').version")"
app_path="dist/mac-universal/ShekelSync.app"
dmg_path="dist/ShekelSync-${app_version}-universal.dmg"
zip_path="dist/ShekelSync-${app_version}-universal-mac.zip"
update_manifest_path="dist/latest-mac.yml"

require_fresh_output() {
  local output_path="$1"

  if [[ ! -e "$output_path" ]]; then
    fail "Expected macOS release output is missing: $output_path"
  fi
  if [[ ! "$output_path" -nt "$MACOS_BUILD_MARKER" ]]; then
    fail "Refusing stale macOS release output: $output_path"
  fi
}

require_fresh_output "$app_path"
require_fresh_output "$dmg_path"
require_fresh_output "$zip_path"
require_fresh_output "$update_manifest_path"

validate_app_bundle() {
  local label="$1"
  local bundle_path="$2"
  local signature_details
  local assessment
  local expected_authority_pattern

  if [[ ! -d "$bundle_path" ]]; then
    fail "$label does not contain ShekelSync.app at the expected path: $bundle_path"
  fi

  echo "Validating $label: $bundle_path"
  codesign --verify --deep --strict --verbose=2 "$bundle_path"

  if ! signature_details="$(codesign --display --verbose=4 "$bundle_path" 2>&1)"; then
    fail "Unable to inspect the code signature for $label"
  fi

  if ! grep -Fqx "Identifier=com.shekelsync.finance" <<<"$signature_details"; then
    fail "$label has an unexpected application identifier"
  fi
  if ! grep -Fqx "TeamIdentifier=$EXPECTED_APPLE_TEAM_ID" <<<"$signature_details"; then
    fail "$label is not signed by the expected TeamIdentifier $EXPECTED_APPLE_TEAM_ID"
  fi

  expected_authority_pattern="^Authority=Developer ID Application: .+ \\(${EXPECTED_APPLE_TEAM_ID}\\)$"
  if ! grep -Eq "$expected_authority_pattern" <<<"$signature_details"; then
    fail "$label is not signed by the expected Developer ID Application authority"
  fi
  if ! grep -Eq '^CodeDirectory .*flags=.*runtime' <<<"$signature_details"; then
    fail "$label is not signed with the hardened runtime flag"
  fi

  xcrun stapler validate "$bundle_path"

  if ! assessment="$(spctl --assess --type execute --verbose=4 "$bundle_path" 2>&1)"; then
    printf '%s\n' "$assessment" >&2
    fail "Gatekeeper rejected $label"
  fi
  printf '%s\n' "$assessment"
  if ! grep -Fq 'source=Notarized Developer ID' <<<"$assessment"; then
    fail "$label did not receive the expected Notarized Developer ID assessment"
  fi
}

validate_app_bundle "fresh electron-builder app" "$app_path"

temporary_root="${RUNNER_TEMP:-/tmp}"
zip_extract_dir="$(mktemp -d "$temporary_root/shekelsync-release-zip.XXXXXX")"
dmg_mount_dir="$(mktemp -d "$temporary_root/shekelsync-release-dmg.XXXXXX")"
dmg_attached=false

cleanup() {
  set +e
  if [[ "$dmg_attached" == true ]]; then
    hdiutil detach "$dmg_mount_dir" -quiet
  fi
  rm -rf -- "$zip_extract_dir" "$dmg_mount_dir"
}
trap cleanup EXIT

ditto -x -k "$zip_path" "$zip_extract_dir"
validate_app_bundle "published ZIP" "$zip_extract_dir/ShekelSync.app"

hdiutil attach "$dmg_path" -readonly -nobrowse -mountpoint "$dmg_mount_dir" >/dev/null
dmg_attached=true
validate_app_bundle "published DMG" "$dmg_mount_dir/ShekelSync.app"
hdiutil detach "$dmg_mount_dir" -quiet
dmg_attached=false

echo "macOS release validation passed for Developer ID team $EXPECTED_APPLE_TEAM_ID"
