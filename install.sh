#!/bin/sh
# Installs the standalone HyperFrames CLI from GitHub Releases.
#
#   curl -fsSL https://raw.githubusercontent.com/ryu1845/hyperframes/main/install.sh | sh
#
# Re-run it to upgrade. Environment:
#   HYPERFRAMES_VERSION        release to install, e.g. 0.9.0 (default: the latest)
#   HYPERFRAMES_INSTALL_DIR    where the binary goes (default: ~/.local/bin)
#   HYPERFRAMES_DOWNLOAD_BASE  URL prefix holding the release assets (mirrors, tests)
set -eu

REPO="ryu1845/hyperframes"
INSTALL_DIR="${HYPERFRAMES_INSTALL_DIR:-$HOME/.local/bin}"

fail() {
  echo "hyperframes install: $*" >&2
  exit 1
}

os="$(uname -s)"
arch="$(uname -m)"
# An x86_64 shell under Rosetta still runs on Apple Silicon.
if [ "$os" = "Darwin" ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  arch="arm64"
fi
case "$os-$arch" in
  Darwin-arm64) target="darwin-arm64" ;;
  Linux-x86_64 | Linux-amd64) target="linux-x64" ;;
  Linux-aarch64 | Linux-arm64) target="linux-arm64" ;;
  Darwin-x86_64) fail "Intel Macs are not supported; the macOS build is for Apple Silicon." ;;
  *) fail "no HyperFrames binary for $os $arch (available: darwin-arm64, linux-x64, linux-arm64)." ;;
esac
if [ "$os" = "Linux" ] && ldd --version 2>&1 | grep -qi musl; then
  fail "the Linux build needs glibc; this system uses musl (Alpine?)."
fi

if [ -n "${HYPERFRAMES_DOWNLOAD_BASE:-}" ]; then
  base="$HYPERFRAMES_DOWNLOAD_BASE"
elif [ -n "${HYPERFRAMES_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/v${HYPERFRAMES_VERSION#v}"
else
  base="https://github.com/$REPO/releases/latest/download"
fi
asset="hyperframes-$target"

command -v curl >/dev/null 2>&1 || fail "curl is required."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "Downloading $asset from $base"
curl -fSL --retry 2 --progress-bar -o "$tmp/$asset" "$base/$asset" ||
  fail "could not download $base/$asset"
curl -fsSL --retry 2 -o "$tmp/$asset.sha256" "$base/$asset.sha256" ||
  fail "could not download $base/$asset.sha256"

expected="$(cut -d ' ' -f 1 <"$tmp/$asset.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d ' ' -f 1)"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d ' ' -f 1)"
else
  fail "sha256sum or shasum is required to verify the download."
fi
[ "$expected" = "$actual" ] || fail "checksum mismatch for $asset (expected $expected, got $actual)."

chmod +x "$tmp/$asset"
if [ "$os" = "Darwin" ]; then
  xattr -d com.apple.quarantine "$tmp/$asset" 2>/dev/null || true
fi
mkdir -p "$INSTALL_DIR"
mv -f "$tmp/$asset" "$INSTALL_DIR/hyperframes"

# The first run unpacks the runtime, so later commands start at full speed.
version="$("$INSTALL_DIR/hyperframes" --version)" || fail "the installed binary does not run."
echo "Installed hyperframes $version to $INSTALL_DIR/hyperframes"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "Add it to your PATH: export PATH=\"$INSTALL_DIR:\$PATH\"" ;;
esac
