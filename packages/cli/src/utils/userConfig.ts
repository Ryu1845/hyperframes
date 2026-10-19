import * as fs from "node:fs";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { normalizeErrorMessage } from "./errorMessage.js";
import { isAttendedTerminal } from "./attendedTerminal.js";
import { withFileLock } from "../media-use/lib/config-lock.mjs";

// ---------------------------------------------------------------------------
// User settings: ~/.hyperframes/config.json
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".hyperframes");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// ---------------------------------------------------------------------------
// Install-state file: ~/.hyperframes/install-state.json
//
// Carries one safety fact apart from config.json: whether the DE
// parallel-router circuit breaker has tripped on this machine. config.json is
// rewritten often and recovers from any read failure by starting over, so a
// tripped breaker kept only there could be lost and the machine re-enrolled
// into an experimental path that already failed on it. Same directory as
// config.json, so `rm -rf ~/.hyperframes` is still a full reset.
// ---------------------------------------------------------------------------

const STATE_FILE = join(CONFIG_DIR, "install-state.json");

interface InstallState {
  /** ISO timestamp of when the file was first written. */
  markerAt: string;
  deParallelRouterTrialFired?: boolean;
}

export interface HyperframesConfig {
  /** Has the user agreed to download the on-device search model? Undefined means never asked. */
  localEmbeddingEnabled?: boolean;
  /**
   * True once the DE parallel-router experiment ("HF_DE_PARALLEL_ROUTER") has
   * actually FAILED (its self-verify/generic-failure safety net fired) on a
   * render from this install; only a real failure turns it off, and only for
   * this install going forward. See `renderLocal`'s
   * `maybeEnableDeParallelRouterTrial`/`maybeConsumeDeParallelRouterTrial`.
   */
  deParallelRouterTrialFired?: boolean;
  /**
   * Count of engaged (routed or reverted) trial renders so far — the backstop
   * that caps exposure even absent an actual failure. See
   * `DE_PARALLEL_ROUTER_TRIAL_MAX_RENDERS` in `render.ts`.
   */
  deParallelRouterTrialRenderCount?: number;
}

let cachedConfig: HyperframesConfig | null = null;

function readInstallState(): InstallState | null {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as Partial<InstallState>;
    return {
      markerAt: typeof parsed.markerAt === "string" ? parsed.markerAt : new Date().toISOString(),
      deParallelRouterTrialFired: parsed.deParallelRouterTrialFired === true ? true : undefined,
    };
  } catch {
    return null;
  }
}

// ONLY the positive is cached: once some process trips the latch it stays
// tripped, but a cached `false` would go stale in a long-lived process (the
// preview server) after another process trips it.
let latchedFiredSeen = false;

/** Is the breaker latched according to install-state? Merged into every read. */
function installStateLatchedFired(): boolean {
  if (latchedFiredSeen) return true;
  latchedFiredSeen = readInstallState()?.deParallelRouterTrialFired === true;
  return latchedFiredSeen;
}

/** Test-only: forget the cached latch (module state leaks across vitest cases). */
export function __resetInstallStateSyncForTests(): void {
  latchedFiredSeen = false;
}

/** Mirror a tripped breaker into install-state. @returns false if the mirror could not be written. */
function syncInstallState(config: HyperframesConfig): boolean {
  if (config.deParallelRouterTrialFired !== true) return true;
  try {
    const state = readInstallState();
    if (state?.deParallelRouterTrialFired !== true) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      const next: InstallState = {
        markerAt: state?.markerAt ?? new Date().toISOString(),
        deParallelRouterTrialFired: true,
      };
      const tmpFile = `${STATE_FILE}.${process.pid}.tmp`;
      writeFileSync(tmpFile, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
      renameSync(tmpFile, STATE_FILE);
    }
    latchedFiredSeen = true;
    return true;
  } catch {
    return false;
  }
}

/** Absent means never asked; anything present but not `true` counts as a no. */
function consentFrom(value: unknown): boolean | undefined {
  return value === undefined ? undefined : value === true;
}

function materializeConfig(parsed: Partial<HyperframesConfig>): HyperframesConfig {
  return {
    localEmbeddingEnabled: consentFrom(parsed.localEmbeddingEnabled),
    // Explicit `=== true`/typeof-number checks: a hand-edited config could carry
    // the STRING "false", which is truthy. A latch recorded in install-state
    // wins over an untripped config.json, never the reverse.
    deParallelRouterTrialFired:
      parsed.deParallelRouterTrialFired === true || installStateLatchedFired() ? true : undefined,
    deParallelRouterTrialRenderCount:
      typeof parsed.deParallelRouterTrialRenderCount === "number"
        ? parsed.deParallelRouterTrialRenderCount
        : undefined,
  };
}

/** Read the settings; returns a mutable copy — call `writeConfig()` to persist changes. */
export function readConfig(): HyperframesConfig {
  if (cachedConfig) return { ...cachedConfig };
  if (!existsSync(CONFIG_FILE)) {
    cachedConfig = materializeConfig({});
    return { ...cachedConfig };
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Partial<HyperframesConfig>;
    cachedConfig = materializeConfig(parsed);
    return { ...cachedConfig };
  } catch {
    // An existing file that cannot be read may hold a no for the model download,
    // so recovery fails closed for that consent; the breaker latch still comes
    // from install-state.
    return { ...materializeConfig({}), localEmbeddingEnabled: false };
  }
}

/**
 * Re-read the config from disk, bypassing the in-process cache. Use
 * immediately before a targeted single-field read-modify-write (e.g. the DE
 * parallel-router trial's render count/fired flag) to narrow the window for a
 * lost update against a concurrently-running CLI process.
 */
export function readConfigFresh(): HyperframesConfig {
  cachedConfig = null;
  return readConfig();
}

/**
 * Persist config to disk. Updates the in-memory cache on success. Atomic: a
 * pid-suffixed temp file renamed over the config, so a concurrent reader never
 * sees a torn file. Returns whether the write landed; errors are swallowed.
 */
export function writeConfig(config: HyperframesConfig): boolean {
  return writeConfigWithResult(config).ok;
}

export type ConfigWriteResult =
  // `mirrored: false` means config.json landed but the install-state mirror
  // did not. Not a write failure — the latch is merged back in on read — but
  // callers persisting a tripped breaker may want to retry or warn.
  { ok: true; mirrored?: false } | { ok: false; error: string };

/**
 * Persist config and retain the failure reason for user-facing commands that
 * must distinguish a durable preference write from a best-effort update.
 */
export function writeConfigWithResult(config: HyperframesConfig): ConfigWriteResult {
  try {
    // The consent answer changes only through updateLocalModelConsent; a copy read earlier must not undo one.
    return withConfigLock(() =>
      persistConfig({ ...config, localEmbeddingEnabled: localModelConsentOnDisk() }),
    );
  } catch (error) {
    warnSettingsLockedOnce(error);
    return { ok: false, error: normalizeErrorMessage(error) };
  }
}

let warnedSettingsLocked = false;

/** One line per process while a leftover lock blocks settings; never where a program reads the output. */
function warnSettingsLockedOnce(error: unknown): void {
  if (warnedSettingsLocked || (error as NodeJS.ErrnoException)?.code !== "HF_SETTINGS_LOCKED")
    return;
  warnedSettingsLocked = true;
  if (
    !isAttendedTerminal() ||
    process.argv.some((arg) => arg === "--json" || arg.startsWith("--json="))
  )
    return;
  console.error(`${(error as Error).message} (see \`hyperframes doctor\`).`);
}

export function updateLocalModelConsent(
  decide: (onDisk: boolean | undefined) => boolean | undefined,
): boolean | undefined {
  try {
    return withConfigLock(() => {
      const onDisk = localModelConsentOnDisk();
      const next = decide(onDisk);
      if (next === onDisk) {
        if (cachedConfig) cachedConfig.localEmbeddingEnabled = onDisk;
        return next;
      }
      const written = persistConfig({ ...readConfigFresh(), localEmbeddingEnabled: next });
      return written.ok ? next : localModelConsentOnDisk();
    });
  } catch (error) {
    warnSettingsLockedOnce(error);
    return localModelConsentOnDisk();
  }
}

function localModelConsentOnDisk(): boolean | undefined {
  try {
    return consentFrom(JSON.parse(readFileSync(CONFIG_FILE, "utf-8")).localEmbeddingEnabled);
  } catch (error) {
    // A settings file that exists but cannot be read may hold a no; only a missing one was never asked.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : false;
  }
}

let holdingConfigLock = false;

/** One process at a time between reading config.json and replacing it; re-entrant within this one. */
function withConfigLock<T>(task: () => T): T {
  if (holdingConfigLock) return task();
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  return withFileLock(`${CONFIG_FILE}.lock`, fs, () => {
    holdingConfigLock = true;
    try {
      return task();
    } finally {
      holdingConfigLock = false;
    }
  });
}

function persistConfig(config: HyperframesConfig): ConfigWriteResult {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const tmpFile = `${CONFIG_FILE}.${process.pid}.tmp`;
    writeFileSync(tmpFile, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    renameSync(tmpFile, CONFIG_FILE);
    cachedConfig = { ...config };
    return syncInstallState(config) ? { ok: true } : { ok: true, mirrored: false };
  } catch (error) {
    return { ok: false, error: normalizeErrorMessage(error) };
  }
}

/** The settings file's path, for `doctor`'s settings-lock check. */
export const CONFIG_PATH = CONFIG_FILE;
