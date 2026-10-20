import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The standalone binary is Bun plus a gzipped tar of the published CLI and its
 * node_modules. It unpacks once per version and runs the CLI from disk, so every
 * lookup next to the CLI, native addon and esbuild binary resolves as in a package
 * install.
 */

/** Set by the launcher to the binary's own path, for children that must reuse it. */
export const BINARY_ENV = "HYPERFRAMES_BINARY";
/** Set by the launcher to the unpacked runtime root. */
export const RUNTIME_ROOT_ENV = "HYPERFRAMES_RUNTIME_ROOT";
/** Asks a child launch of the binary to run argv[2] as a script instead of the CLI. */
export const EXEC_ENV = "HF_BINARY_EXEC";

/** Written last, so a root holding it is a complete extraction. */
export const COMPLETE_MARKER = ".complete";

const STALE_STAGING_MS = 60 * 60 * 1000;

export function runtimeParent(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (env.HYPERFRAMES_RUNTIME_DIR) return env.HYPERFRAMES_RUNTIME_DIR;
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "hyperframes", "runtime");
}

export function runtimeDirName(version: string, payloadSha: string): string {
  return `${version}-${payloadSha.slice(0, 12)}`;
}

export function cliEntry(root: string): string {
  return join(root, "node_modules", "@hyperframes", "cli", "dist", "cli.js");
}

function extractTarGz(payload: Uint8Array, dir: string): void {
  const result = spawnSync("tar", ["-xzf", "-", "-C", dir], {
    input: payload,
    stdio: ["pipe", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Could not run tar to unpack the HyperFrames runtime: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`tar failed to unpack the HyperFrames runtime: ${result.stderr.trim()}`);
  }
}

/**
 * Unpacks into a sibling staging dir, then renames, so `root` only ever holds a
 * complete runtime. Two first runs both unpack and the loser discards its copy.
 */
export function ensureRuntime(
  root: string,
  readPayload: () => Uint8Array,
  extract: (payload: Uint8Array, dir: string) => void = extractTarGz,
): void {
  if (existsSync(join(root, COMPLETE_MARKER))) return;
  const staging = `${root}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(staging, { recursive: true });
  try {
    extract(readPayload(), staging);
    writeFileSync(join(staging, COMPLETE_MARKER), "");
    if (existsSync(root) && !existsSync(join(root, COMPLETE_MARKER))) {
      rmSync(root, { recursive: true, force: true });
    }
    try {
      renameSync(staging, root);
    } catch (err) {
      if (!existsSync(join(root, COMPLETE_MARKER))) throw err;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Keeps the `current` runtime dir and the most recently used other one: a detached background
 * preview started by the previous version still loads chunks from its own root.
 * Abandoned staging dirs go once they are old enough not to be a live extraction.
 */
export function pruneRuntimes(parent: string, current: string, now = Date.now()): void {
  try {
    utimesSync(join(parent, current), now / 1000, now / 1000);
  } catch {
    // Best effort: the mtime only orders which older runtime survives.
  }
  const others: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of readdirSync(parent)) {
    if (entry === current) continue;
    const path = join(parent, entry);
    const mtimeMs = statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? now;
    if (entry.includes(".tmp-")) {
      if (now - mtimeMs > STALE_STAGING_MS) rmSync(path, { recursive: true, force: true });
      continue;
    }
    others.push({ path, mtimeMs });
  }
  others.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const stale of others.slice(1)) rmSync(stale.path, { recursive: true, force: true });
}
