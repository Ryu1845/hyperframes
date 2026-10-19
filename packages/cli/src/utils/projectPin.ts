import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compareVersions } from "compare-versions";
import { VERSION } from "../version.js";
import { isDevMode } from "./env.js";

// Matches `hyperframes@<semver>` as a whole token inside a script string, scoped
// or not. Capturing group 1 is the version. `(?=\s|$)` keeps it from matching a
// longer package name.
export const HYPERFRAMES_PIN_RE =
  /\bhyperframes@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=\s|$)/g;

export function readPinnedHyperframesVersions(scripts: Record<string, string>): string[] {
  const found = new Set<string>();
  for (const cmd of Object.values(scripts ?? {})) {
    for (const m of cmd.matchAll(HYPERFRAMES_PIN_RE)) if (m[1]) found.add(m[1]);
  }
  return [...found].sort();
}

function isNewer(a: string, b: string): boolean {
  try {
    return compareVersions(a, b) > 0;
  } catch {
    return false;
  }
}

/**
 * Warn when the running CLI is older than the version this project's npm
 * scripts pin (e.g. a stale npx cache): an older CLI misjudges every run.
 * Offline; silent in dev mode and CI. Writes to stderr only.
 */
export function printOlderThanPinNotice(cwd: string = process.cwd()): void {
  if (isDevMode() || process.env["CI"] === "true" || process.env["CI"] === "1") return;
  let scripts: Record<string, string> = {};
  try {
    const pkgPath = join(cwd, "package.json");
    if (!existsSync(pkgPath)) return;
    scripts = (JSON.parse(readFileSync(pkgPath, "utf-8")).scripts ?? {}) as Record<string, string>;
  } catch {
    return;
  }
  const newerPins = readPinnedHyperframesVersions(scripts)
    .filter((v) => isNewer(v, VERSION))
    .sort(compareVersions);
  if (newerPins.length === 0) return;
  process.stderr.write(
    `\n  This is hyperframes ${VERSION}, but this project pins hyperframes@${newerPins.join(", ")}.\n` +
      `  Run it through the project's npm scripts, or npx hyperframes@${newerPins.at(-1)}.\n\n`,
  );
}
