#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

INPUT_PNG="${1:-${ROOT_DIR}/public/icons/1024x1024.png}"
CANVAS="${2:-1024}"
INSET="${3:-80}"
RADIUS="${4:-200}"
ZOOM="${5:-1.0}"
STRENGTH="${6:-0.60}"
OUTPUT_ICNS="${7:-${ROOT_DIR}/src-tauri/icons/icon.icns}"

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  bash scripts/overwrite_macos_icon.sh [input_png] [canvas] [inset] [radius] [zoom] [strength] [output_icns]

Defaults:
  input_png   = public/icons/1024x1024.png
  canvas      = 1024
  inset       = 80
  radius      = 200
  zoom        = 1.0
  strength    = 0.60
  output_icns = src-tauri/icons/icon.icns

Examples:
  bash scripts/overwrite_macos_icon.sh
  bash scripts/overwrite_macos_icon.sh public/icons/1024x1024.png 1024 80 200 1.05 0.70

Notes:
  - This script only updates macOS icns.
  - It does NOT run `tauri icon`, so iOS icons under src-tauri/gen/apple are not touched.
EOF
  exit 0
fi

for cmd in swift sips iconutil; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
done

if [[ ! -f "${INPUT_PNG}" ]]; then
  echo "Input file not found: ${INPUT_PNG}" >&2
  exit 1
fi

TMP_BASE="${TMPDIR:-/tmp}"
TMP_BASE="${TMP_BASE%/}"
TMP_DIR="$(mktemp -d "${TMP_BASE}/mac-icon.XXXXXX")"
trap 'rm -rf "${TMP_DIR}"' EXIT

ROUNDED_PNG="${TMP_DIR}/app-icon-rounded-mac.png"
ICONSET_DIR="${TMP_DIR}/AppIcon.iconset"
mkdir -p "${ICONSET_DIR}"

# Use a temp HOME so swift module cache stays in writable temp paths.
HOME="${TMP_DIR}/home" swift \
  "${SCRIPT_DIR}/make_rounded_icon.swift" \
  "${INPUT_PNG}" \
  "${ROUNDED_PNG}" \
  "${CANVAS}" \
  "${INSET}" \
  "${RADIUS}" \
  "${ZOOM}" \
  "${STRENGTH}"

sips -z 16 16 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_16x16.png" >/dev/null
sips -z 32 32 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_32x32.png" >/dev/null
sips -z 64 64 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_128x128.png" >/dev/null
sips -z 256 256 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_256x256.png" >/dev/null
sips -z 512 512 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "${ROUNDED_PNG}" --out "${ICONSET_DIR}/icon_512x512.png" >/dev/null
cp "${ROUNDED_PNG}" "${ICONSET_DIR}/icon_512x512@2x.png"

mkdir -p "$(dirname "${OUTPUT_ICNS}")"
iconutil -c icns "${ICONSET_DIR}" -o "${OUTPUT_ICNS}"

echo "Updated macOS icon: ${OUTPUT_ICNS}"
echo "iOS icons were not modified."
