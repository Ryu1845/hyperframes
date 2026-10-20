import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPLETE_MARKER,
  cliEntry,
  ensureRuntime,
  pruneRuntimes,
  runtimeDirName,
  runtimeParent,
} from "./runtime.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-runtime-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tarball(files: Record<string, string>): Uint8Array {
  const src = tempDir();
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(src, path, ".."), { recursive: true });
    writeFileSync(join(src, path), body);
  }
  return execFileSync("tar", ["-czf", "-", "-C", src, "."]);
}

describe("runtimeParent", () => {
  it("prefers HYPERFRAMES_RUNTIME_DIR, then XDG_CACHE_HOME, then ~/.cache", () => {
    expect(runtimeParent({ HYPERFRAMES_RUNTIME_DIR: "/r", XDG_CACHE_HOME: "/x" }, "/h")).toBe("/r");
    expect(runtimeParent({ XDG_CACHE_HOME: "/x" }, "/h")).toBe(
      join("/x", "hyperframes", "runtime"),
    );
    expect(runtimeParent({}, "/h")).toBe(join("/h", ".cache", "hyperframes", "runtime"));
  });

  it("keys a runtime by version and payload digest", () => {
    expect(runtimeDirName("1.2.3", "abcdef0123456789")).toBe("1.2.3-abcdef012345");
    expect(cliEntry("/r")).toBe(
      join("/r", "node_modules", "@hyperframes", "cli", "dist", "cli.js"),
    );
  });
});

describe("ensureRuntime", () => {
  it("unpacks the payload once and marks the root complete", () => {
    const root = join(tempDir(), "1.0.0-abc");
    let reads = 0;
    const read = () => {
      reads += 1;
      return tarball({ "node_modules/x/index.js": "ok" });
    };
    ensureRuntime(root, read);
    ensureRuntime(root, read);
    expect(reads).toBe(1);
    expect(readFileSync(join(root, "node_modules/x/index.js"), "utf8")).toBe("ok");
    expect(existsSync(join(root, COMPLETE_MARKER))).toBe(true);
  });

  it("replaces a root left without its marker and leaves no staging dir", () => {
    const parent = tempDir();
    const root = join(parent, "1.0.0-abc");
    mkdirSync(join(root, "stale"), { recursive: true });
    ensureRuntime(root, () => tarball({ "fresh.txt": "new" }));
    expect(readdirSync(root).sort()).toEqual([COMPLETE_MARKER, "fresh.txt"]);
    expect(readdirSync(parent)).toEqual(["1.0.0-abc"]);
  });

  it("keeps the winner's copy when another run completed first", () => {
    const root = join(tempDir(), "1.0.0-abc");
    ensureRuntime(
      root,
      () => tarball({ "mine.txt": "mine" }),
      (payload, dir) => {
        // Another first run finishes while this one is still unpacking.
        mkdirSync(root, { recursive: true });
        writeFileSync(join(root, "theirs.txt"), "theirs");
        writeFileSync(join(root, COMPLETE_MARKER), "");
        execFileSync("tar", ["-xzf", "-", "-C", dir], { input: payload });
      },
    );
    expect(readdirSync(root).sort()).toEqual([COMPLETE_MARKER, "theirs.txt"]);
  });

  it("names tar's failure", () => {
    const root = join(tempDir(), "1.0.0-abc");
    expect(() => ensureRuntime(root, () => new Uint8Array([1, 2, 3]))).toThrow(/tar failed/);
    expect(existsSync(root)).toBe(false);
  });
});

describe("pruneRuntimes", () => {
  it("keeps the current runtime and the most recently used other one", () => {
    const parent = tempDir();
    const now = Date.now();
    for (const [name, ageMs] of [
      ["0.1.0-a", 3_000],
      ["0.2.0-b", 2_000],
      ["0.3.0-c", 1_000],
    ] as const) {
      mkdirSync(join(parent, name));
      utimesSync(join(parent, name), (now - ageMs) / 1000, (now - ageMs) / 1000);
    }
    pruneRuntimes(parent, "0.1.0-a", now);
    expect(readdirSync(parent).sort()).toEqual(["0.1.0-a", "0.3.0-c"]);
  });

  it("removes abandoned staging dirs but not a live extraction", () => {
    const parent = tempDir();
    const now = Date.now();
    mkdirSync(join(parent, "1.0.0-a"));
    mkdirSync(join(parent, "1.0.0-a.tmp-1-old"));
    mkdirSync(join(parent, "1.0.0-a.tmp-2-live"));
    const hourAgo = (now - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(join(parent, "1.0.0-a.tmp-1-old"), hourAgo, hourAgo);
    pruneRuntimes(parent, "1.0.0-a", now);
    expect(readdirSync(parent).sort()).toEqual(["1.0.0-a", "1.0.0-a.tmp-2-live"]);
  });
});
