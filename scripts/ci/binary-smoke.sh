#!/usr/bin/env bash
# Smoke-tests a standalone hyperframes binary with no Node, npm or Bun on PATH.
#
#   scripts/ci/binary-smoke.sh <binary> [--full]
#
# --full adds the steps that download models or clone the repo: remove-background
# (onnxruntime + sharp), Parakeet transcription (sherpa-onnx, a 640 MB model) and
# `skills update` (bunx). Every step runs; the script exits non-zero if any failed.
# Set KEEP_SMOKE_DIR=1 to keep the work dir for inspection.
set -uo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <binary> [--full]" >&2
  exit 2
fi
BINARY="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
FULL="${2:-}"
WORK="$(mktemp -d)"
FAILED=()
[ -n "${KEEP_SMOKE_DIR:-}" ] || trap 'rm -rf "$WORK"' EXIT

# Only the tools the CLI shells out to; Node, npm and Bun stay off PATH.
mkdir -p "$WORK/bin"
ln -s "$BINARY" "$WORK/bin/hyperframes"
for tool in ffmpeg ffprobe git tar curl; do
  found="$(command -v "$tool" || true)"
  [ -n "$found" ] && ln -sf "$found" "$WORK/bin/$tool"
done
export PATH="$WORK/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HYPERFRAMES_RUNTIME_DIR="$WORK/runtime"
export HYPERFRAMES_SKIP_SKILLS=1
export NO_COLOR=1

step() {
  local name="$1"
  shift
  echo "::group::$name"
  if "$@"; then
    echo "::endgroup::"
    echo "PASS $name"
  else
    echo "::endgroup::"
    echo "FAIL $name"
    FAILED+=("$name")
  fi
}

no_node() { ! command -v node && ! command -v npm && ! command -v npx && ! command -v bun; }

unpacks_once() {
  hyperframes --version && hyperframes --version >/dev/null &&
    [ "$(find "$HYPERFRAMES_RUNTIME_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 1 ]
}

rendered() {
  hyperframes render -o "$WORK/out.mp4" &&
    awk "BEGIN { exit !($(ffprobe -v error -show_entries format=duration -of csv=p=0 -- "$WORK/out.mp4") > 0) }"
}

preview_round_trip() {
  local port=34171 events="$WORK/events.log" ok=1
  hyperframes preview --background --no-open --port "$port" || return 1
  hyperframes preview --status &&
    curl -fsS "http://127.0.0.1:$port/" >/dev/null &&
    [ -n "$(curl -fsS "http://127.0.0.1:$port/api/runtime.js" | head -c 200)" ] &&
    {
      curl -sN --max-time 8 "http://127.0.0.1:$port/api/events" >"$events" &
      local reader=$!
      sleep 2
      echo "<!-- touched -->" >>index.html
      wait "$reader"
      grep -q "^event: file-change" "$events"
    } && ok=0
  hyperframes preview --stop
  return "$ok"
}

step "no node/npm/bun on PATH" no_node
step "unpacks once, --version" unpacks_once
step "docs" hyperframes docs
cd "$WORK" || exit 1
step "init" hyperframes init smoke --example blank --non-interactive
cd "$WORK/smoke" || exit 1
step "lint" hyperframes lint
step "check (Chrome via @puppeteer/browsers)" hyperframes check
step "render" rendered
step "snapshot (sharp)" hyperframes snapshot --frames 2
step "preview --background, live reload, --stop" preview_round_trip
step "media-use doctor (script child)" hyperframes media-use doctor
step "doctor" hyperframes doctor

if [ "$FULL" = "--full" ]; then
  ffmpeg -v error -f lavfi -i "testsrc=size=320x240" -frames:v 1 "$WORK/frame.png" &&
    step "remove-background (onnxruntime + sharp)" hyperframes remove-background "$WORK/frame.png" -o "$WORK/cutout.png"
  step "models install parakeet" hyperframes models install parakeet
  ffmpeg -v error -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 -ac 1 "$WORK/tone.wav" &&
    step "transcribe --engine parakeet (sherpa-onnx)" hyperframes transcribe "$WORK/tone.wav" --engine parakeet --json
  step "skills update (bunx)" env HOME="$WORK/home" HYPERFRAMES_SKIP_SKILLS= hyperframes skills update
fi

echo
if [ ${#FAILED[@]} -gt 0 ]; then
  printf 'Failed: %s\n' "${FAILED[@]}"
  exit 1
fi
echo "All binary smoke steps passed."
