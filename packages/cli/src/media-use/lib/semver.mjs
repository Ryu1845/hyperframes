// Minimal x.y.z version comparison (no prerelease or build metadata), used by
// the resolve --doctor node check.

export function versionLessThan(version, minimum) {
  const left = versionParts(version);
  const right = versionParts(minimum);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) {
    if (left[i] < right[i]) return true;
    if (left[i] > right[i]) return false;
  }
  return false;
}

function versionParts(version) {
  const match = String(version || "").match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : null;
}
