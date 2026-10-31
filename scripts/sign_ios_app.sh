#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILES_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"

usage() {
  cat <<'USAGE'
Usage:
  ./sign-ios-app.sh [input] [output] [mobileprovision] [identity]

Inputs:
  input            Unsigned .app directory, .ipa, or .zip containing an .app.
                   Defaults to ./ios-device-unsigned-app.zip, then ./ios-device-unsigned.ipa.
  output           Signed .ipa path. Defaults to ./<AppName>-signed.ipa.
  mobileprovision  Optional provisioning profile. If omitted, a matching profile is auto-detected.
  identity         Optional codesign identity name or SHA-1 hash. If omitted, a matching identity is auto-detected.

Example:
  ./sign-ios-app.sh ios-device-unsigned-app.zip
USAGE
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

extract_mobileprovision_plist() {
  local profile="$1"
  local plist="$2"

  perl -0ne 'if (/(<\?xml.*?<\/plist>)/s) { print $1; $found = 1 } END { exit($found ? 0 : 1) }' \
    "$profile" > "$plist" || die "failed to extract plist from $profile"
  [ -s "$plist" ] || die "empty plist extracted from $profile"
}

find_app_bundle() {
  local root="$1"
  local app_path=""

  if [ -d "$root/Payload" ]; then
    app_path="$(find "$root/Payload" -maxdepth 1 -type d -name '*.app' -print -quit)"
  fi

  if [ -z "$app_path" ]; then
    app_path="$(find "$root" -maxdepth 1 -type d -name '*.app' -print -quit)"
  fi

  printf '%s\n' "$app_path"
}

profile_bundle_pattern() {
  local plist="$1"
  local app_identifier

  app_identifier="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "$plist")"
  printf '%s\n' "${app_identifier#*.}"
}

find_matching_profile() {
  local bundle_id="$1"
  local profile
  local plist
  local pattern
  local wildcard_match=""

  [ -d "$PROFILES_DIR" ] || die "provisioning profiles directory not found: $PROFILES_DIR"

  for profile in "$PROFILES_DIR"/*.mobileprovision; do
    [ -e "$profile" ] || continue
    plist="$WORK_DIR/profile-$(basename "$profile").plist"

    if ! extract_mobileprovision_plist "$profile" "$plist" >/dev/null 2>&1; then
      continue
    fi

    pattern="$(profile_bundle_pattern "$plist")"
    if [ "$pattern" = "$bundle_id" ]; then
      printf '%s\n' "$profile"
      return 0
    fi

    if [[ "$pattern" == *"*"* && "$bundle_id" == $pattern ]]; then
      wildcard_match="$profile"
    fi
  done

  [ -n "$wildcard_match" ] && printf '%s\n' "$wildcard_match"
}

profile_certificate_hashes() {
  local profile_plist="$1"
  local hashes_file="$2"
  local cert_raw
  local cert_der
  local fingerprint
  local idx=0

  : > "$hashes_file"
  while true; do
    cert_raw="$WORK_DIR/profile-cert-$idx.base64"
    cert_der="$WORK_DIR/profile-cert-$idx.der"

    if ! /usr/bin/plutil -extract "DeveloperCertificates.$idx" raw -o "$cert_raw" "$profile_plist" >/dev/null 2>&1; then
      break
    fi

    base64 -D -i "$cert_raw" -o "$cert_der"
    fingerprint="$(openssl x509 -inform DER -in "$cert_der" -noout -fingerprint -sha1 \
      | sed 's/^.*=//; s/://g')"
    printf '%s\n' "$fingerprint" >> "$hashes_file"
    idx=$((idx + 1))
  done

  [ -s "$hashes_file" ] || die "no developer certificates found in provisioning profile"
}

find_matching_identity() {
  local profile_plist="$1"
  local hashes_file="$WORK_DIR/profile-cert-hashes.txt"
  local identity_hash

  profile_certificate_hashes "$profile_plist" "$hashes_file"

  while read -r identity_hash; do
    if grep -qx "$identity_hash" "$hashes_file"; then
      printf '%s\n' "$identity_hash"
      return 0
    fi
  done < <(security find-identity -v -p codesigning | awk '$2 ~ /^[0-9A-F]{40}$/ { print $2 }')

  return 1
}

sign_nested_code() {
  local app_path="$1"
  local identity="$2"
  local item

  while IFS= read -r item; do
    codesign --force --sign "$identity" $TIMESTAMP_FLAG "$item"
  done < <(find "$app_path" -depth \( -type d \( -name '*.framework' -o -name '*.appex' \) -o -type f -name '*.dylib' \) -print)
}

need_cmd base64
need_cmd codesign
need_cmd ditto
need_cmd find
need_cmd openssl
need_cmd perl
need_cmd plutil
need_cmd security
need_cmd sed

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

INPUT="${1:-}"
OUTPUT="${2:-}"
PROFILE="${3:-}"
IDENTITY="${4:-}"

if [ -z "$INPUT" ]; then
  if [ -f "$SCRIPT_DIR/ios-device-unsigned-app.zip" ]; then
    INPUT="$SCRIPT_DIR/ios-device-unsigned-app.zip"
  elif [ -f "$SCRIPT_DIR/ios-device-unsigned.ipa" ]; then
    INPUT="$SCRIPT_DIR/ios-device-unsigned.ipa"
  else
    usage
    die "no input provided and no default unsigned package found"
  fi
fi

[ -e "$INPUT" ] || die "input not found: $INPUT"

WORK_DIR="$(mktemp -d /private/tmp/ios-resign.XXXXXX)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

EXTRACT_DIR="$WORK_DIR/extracted"
SIGN_DIR="$WORK_DIR/sign"
APP_SOURCE=""

mkdir -p "$EXTRACT_DIR" "$SIGN_DIR/Payload"

if [ -d "$INPUT" ]; then
  case "$INPUT" in
    *.app) APP_SOURCE="$INPUT" ;;
    *) die "input directory must be an .app bundle: $INPUT" ;;
  esac
else
  case "$INPUT" in
    *.ipa|*.zip)
      ditto -x -k "$INPUT" "$EXTRACT_DIR"
      APP_SOURCE="$(find_app_bundle "$EXTRACT_DIR")"
      ;;
    *) die "input must be an .app directory, .ipa, or .zip: $INPUT" ;;
  esac
fi

[ -n "$APP_SOURCE" ] || die "no .app bundle found in input"
[ -f "$APP_SOURCE/Info.plist" ] || die "Info.plist not found in app bundle"

APP_NAME="$(basename "$APP_SOURCE")"
APP_PATH="$SIGN_DIR/Payload/$APP_NAME"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_SOURCE/Info.plist")"

if [ -z "$OUTPUT" ]; then
  OUTPUT="$SCRIPT_DIR/${APP_NAME%.app}-signed.ipa"
else
  case "$OUTPUT" in
    /*) ;;
    *) OUTPUT="$PWD/$OUTPUT" ;;
  esac
fi

if [ -z "$PROFILE" ]; then
  PROFILE="$(find_matching_profile "$BUNDLE_ID")"
  [ -n "$PROFILE" ] || die "no provisioning profile matches bundle id: $BUNDLE_ID"
fi

[ -f "$PROFILE" ] || die "provisioning profile not found: $PROFILE"

SELECTED_PROFILE_PLIST="$WORK_DIR/selected-profile.plist"
ENTITLEMENTS="$WORK_DIR/entitlements.plist"
extract_mobileprovision_plist "$PROFILE" "$SELECTED_PROFILE_PLIST"

PROFILE_PATTERN="$(profile_bundle_pattern "$SELECTED_PROFILE_PLIST")"
if ! [[ "$PROFILE_PATTERN" == "$BUNDLE_ID" || "$PROFILE_PATTERN" == *"*"* && "$BUNDLE_ID" == $PROFILE_PATTERN ]]; then
  die "profile bundle id ($PROFILE_PATTERN) does not match app bundle id ($BUNDLE_ID)"
fi

if [ -z "$IDENTITY" ]; then
  IDENTITY="$(find_matching_identity "$SELECTED_PROFILE_PLIST")" \
    || die "no valid codesigning identity matches the selected provisioning profile"
fi

# Re-evaluate TIMESTAMP_FLAG after IDENTITY is resolved
if [[ "$IDENTITY" == *"Distribution"* || "$IDENTITY" == *"distribution"* ]]; then
  printf 'Distribution identity detected. Enabling secure timestamp for App Store validation...\n'
  TIMESTAMP_FLAG="--timestamp"
else
  TIMESTAMP_FLAG="--timestamp=none"
fi

/usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$SELECTED_PROFILE_PLIST" > "$ENTITLEMENTS"

ditto "$APP_SOURCE" "$APP_PATH"
cp "$PROFILE" "$APP_PATH/embedded.mobileprovision"

sign_nested_code "$APP_PATH" "$IDENTITY"
codesign --force --sign "$IDENTITY" --entitlements "$ENTITLEMENTS" $TIMESTAMP_FLAG "$APP_PATH"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

mkdir -p "$(dirname "$OUTPUT")"
( cd "$SIGN_DIR" && ditto -c -k --sequesterRsrc --keepParent Payload "$OUTPUT" )

printf 'Signed %s\n' "$OUTPUT"
printf 'Bundle ID: %s\n' "$BUNDLE_ID"
printf 'Profile: %s\n' "$PROFILE"
printf 'Identity: %s\n' "$IDENTITY"
