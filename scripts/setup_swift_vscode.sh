#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apple_dir="$repo_root/src-tauri/gen/apple"
build_server_path="$repo_root/buildServer.json"
xcode_build_server="$(command -v xcode-build-server || true)"

if [ -z "$xcode_build_server" ]; then
  printf 'xcode-build-server is not installed or not on PATH.\n' >&2
  printf 'Install it with: brew install xcode-build-server\n' >&2
  exit 1
fi

build_settings="$(
  xcodebuild \
    -showBuildSettings \
    -json \
    -project "$apple_dir/app.xcodeproj" \
    -scheme app_iOS \
    2>/dev/null
)"

derived_data="$(
  printf '%s' "$build_settings" | python3 -c '
import json
import os
import sys

raw = sys.stdin.read()
decoder = json.JSONDecoder()
data = None
offset = 0

while True:
    start = raw.find("[", offset)
    if start < 0:
        break
    try:
        candidate = decoder.raw_decode(raw[start:])[0]
    except json.JSONDecodeError:
        offset = start + 1
        continue
    if isinstance(candidate, list) and candidate and "buildSettings" in candidate[0]:
        data = candidate
        break
    offset = start + 1

if data is None:
    raise SystemExit("Could not find JSON build settings in xcodebuild output")

settings = data[0]["buildSettings"]
symroot = settings["SYMROOT"]
print(os.path.abspath(os.path.join(symroot, "../..")))
'
)"

python3 - "$build_server_path" "$xcode_build_server" "$derived_data" <<'PY'
import json
import sys

build_server_path, xcode_build_server, derived_data = sys.argv[1:]
config = {
    "name": "xcode build server",
    "version": "1.3.0",
    "bspVersion": "2.2.0",
    "languages": ["c", "cpp", "objective-c", "objective-cpp", "swift"],
    "argv": [xcode_build_server],
    "build_root": derived_data,
    "scheme": "app_iOS",
    "kind": "xcode",
    "skip_validate_bin": True,
}

with open(build_server_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent="\t")
    f.write("\n")
PY

printf 'Generated %s\n' "$build_server_path"
printf 'Using Xcode DerivedData: %s\n' "$derived_data"
