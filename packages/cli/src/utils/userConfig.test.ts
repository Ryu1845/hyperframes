import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory fake filesystem so these tests exercise the REAL userConfig.ts
// module (parsing, caching, readConfigFresh's cache-bypass) without ever
// touching the developer/CI machine's actual ~/.hyperframes/config.json —
// homedir() is resolved once at userConfig.ts's module-load time, so faking
// HOME via env var would only work in a fresh process, not inside a shared
// vitest worker.
const fsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
  fds: new Map<number, string>(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn((path: string) => fsState.files.has(path)),
  mkdirSync: vi.fn(() => undefined),
  readFileSync: vi.fn((path: string) => {
    const content = fsState.files.get(path);
    if (content === undefined)
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    return content;
  }),
  writeFileSync: vi.fn((path: string, content: string) => {
    fsState.files.set(path, content);
  }),
  // writeConfig writes atomically: temp file + rename over the target.
  renameSync: vi.fn((from: string, to: string) => {
    const content = fsState.files.get(from);
    if (content === undefined) throw new Error(`ENOENT: ${from}`);
    fsState.files.set(to, content);
    fsState.files.delete(from);
  }),
  // The settings lock's release.
  rmSync: vi.fn((path: string) => {
    fsState.files.delete(path);
  }),
  // The settings lock: an exclusive create, then the owner's token written through the descriptor.
  openSync: vi.fn((path: string, flag: string) => {
    if (flag === "wx" && fsState.files.has(path))
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: "EEXIST" });
    fsState.files.set(path, "");
    fsState.fds.set(3, path);
    return 3;
  }),
  writeSync: vi.fn((fd: number, data: string) => {
    const path = fsState.fds.get(fd) ?? "";
    fsState.files.set(path, (fsState.files.get(path) ?? "") + data);
  }),
  closeSync: vi.fn(),
  linkSync: vi.fn(),
  statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
}));

type UserConfigModule = typeof import("./userConfig.js");

let mod: UserConfigModule;
const STATE_SUFFIX = "install-state.json";
const statePath = () => mod.CONFIG_PATH.replace(/config\.json$/, STATE_SUFFIX);

beforeEach(async () => {
  fsState.files.clear();
  // Fresh module instance per test — the cached read is module-scoped.
  vi.resetModules();
  mod = await import("./userConfig.js");
});

describe("readConfig / readConfigFresh / writeConfig (real module, faked fs)", () => {
  it("starts with nothing decided and writes nothing when no file exists", () => {
    expect(mod.readConfig()).toEqual({
      localEmbeddingEnabled: undefined,
      deParallelRouterTrialFired: undefined,
      deParallelRouterTrialRenderCount: undefined,
    });
    expect(fsState.files.has(mod.CONFIG_PATH)).toBe(false);
  });

  it("caches the read — a second readConfig() call does not see a file mutated out from under it", () => {
    mod.readConfig();
    fsState.files.set(mod.CONFIG_PATH, JSON.stringify({ deParallelRouterTrialFired: true }));
    expect(mod.readConfig().deParallelRouterTrialFired).toBeUndefined();
  });

  it("readConfigFresh bypasses the cache and picks up a file written by another process", () => {
    mod.readConfig();
    fsState.files.set(mod.CONFIG_PATH, JSON.stringify({ deParallelRouterTrialFired: true }));
    expect(mod.readConfigFresh().deParallelRouterTrialFired).toBe(true);
  });

  it("writeConfig updates the in-process cache so a subsequent readConfig() sees the write immediately", () => {
    const config = mod.readConfig();
    config.deParallelRouterTrialRenderCount = 5;
    mod.writeConfig(config);
    expect(mod.readConfig().deParallelRouterTrialRenderCount).toBe(5);
  });

  it('treats a non-boolean deParallelRouterTrialFired (e.g. the JSON string "false") as unset, not truthy', () => {
    fsState.files.set(mod.CONFIG_PATH, JSON.stringify({ deParallelRouterTrialFired: "false" }));
    expect(mod.readConfig().deParallelRouterTrialFired).toBeUndefined();
  });

  it("treats a non-number deParallelRouterTrialRenderCount as unset", () => {
    fsState.files.set(mod.CONFIG_PATH, JSON.stringify({ deParallelRouterTrialRenderCount: "5" }));
    expect(mod.readConfig().deParallelRouterTrialRenderCount).toBeUndefined();
  });

  it("counts an unreadable file as a no to the model download", () => {
    fsState.files.set(mod.CONFIG_PATH, "{not valid json");
    expect(mod.readConfig().localEmbeddingEnabled).toBe(false);
  });

  it("drops settings it no longer knows when it writes the file back", () => {
    fsState.files.set(
      mod.CONFIG_PATH,
      JSON.stringify({
        anonymousId: "old-id",
        telemetryEnabled: true,
        localEmbeddingEnabled: true,
      }),
    );
    mod.writeConfig(mod.readConfig());
    const written = JSON.parse(fsState.files.get(mod.CONFIG_PATH) ?? "{}");
    expect(written).not.toHaveProperty("anonymousId");
    expect(written).not.toHaveProperty("telemetryEnabled");
    expect(written.localEmbeddingEnabled).toBe(true);
  });

  it("writeConfig reports success, leaves no temp file behind, and reports failure when the fs throws", async () => {
    const config = mod.readConfig();
    expect(mod.writeConfig(config)).toBe(true);
    for (const path of fsState.files.keys()) expect(path.endsWith(".tmp")).toBe(false);

    const fs = await import("node:fs");
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });
    expect(mod.writeConfig(config)).toBe(false);

    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw new Error("ENOSPC: disk full");
    });
    expect(mod.writeConfigWithResult(config)).toEqual({ ok: false, error: "ENOSPC: disk full" });
  });
});

describe("the breaker latch survives losing config.json", () => {
  function tripBreaker(): void {
    const config = mod.readConfig();
    config.deParallelRouterTrialFired = true;
    expect(mod.writeConfig(config)).toBe(true);
  }

  it("a tripped breaker survives a config wipe", async () => {
    tripBreaker();
    fsState.files.delete(mod.CONFIG_PATH);
    vi.resetModules();
    mod = await import("./userConfig.js");
    expect(mod.readConfig().deParallelRouterTrialFired).toBe(true);
  });

  it("a tripped breaker survives config corruption", async () => {
    tripBreaker();
    fsState.files.set(mod.CONFIG_PATH, "{not valid json");
    vi.resetModules();
    mod = await import("./userConfig.js");
    expect(mod.readConfig().deParallelRouterTrialFired).toBe(true);
  });

  it("an untripped breaker is never invented", () => {
    mod.writeConfig(mod.readConfig());
    fsState.files.delete(mod.CONFIG_PATH);
    expect(mod.readConfigFresh().deParallelRouterTrialFired).toBeUndefined();
    expect(fsState.files.has(statePath())).toBe(false);
  });

  // The stale-writer race: a concurrent process rewrites config.json from a
  // snapshot taken before the breaker fired. The latch is merged on read.
  it("rehydrates a latched breaker when config.json says otherwise", () => {
    fsState.files.set(
      statePath(),
      JSON.stringify({ markerAt: "2026-07-28T00:00:00.000Z", deParallelRouterTrialFired: true }),
    );
    fsState.files.set(mod.CONFIG_PATH, JSON.stringify({}));
    expect(mod.readConfig().deParallelRouterTrialFired).toBe(true);
  });

  // Only `true` is monotonic across processes; a cached `false` would freeze a
  // stale negative in a long-lived process (the preview server).
  it("re-reads a negative latch: false -> external trip -> fresh read is true", () => {
    fsState.files.set(mod.CONFIG_PATH, JSON.stringify({}));
    expect(mod.readConfig().deParallelRouterTrialFired).toBeUndefined();
    fsState.files.set(
      statePath(),
      JSON.stringify({ markerAt: "2026-07-28T00:00:00.000Z", deParallelRouterTrialFired: true }),
    );
    expect(mod.readConfigFresh().deParallelRouterTrialFired).toBe(true);
  });

  it("reports mirrored:false when the state write fails but config.json lands", async () => {
    const config = mod.readConfig();
    const fs = await import("node:fs");
    mod.__resetInstallStateSyncForTests();
    vi.mocked(fs.writeFileSync).mockImplementation((path, content) => {
      if (String(path).startsWith(statePath())) throw new Error("EACCES");
      fsState.files.set(String(path), String(content));
    });
    config.deParallelRouterTrialFired = true;
    expect(mod.writeConfigWithResult(config)).toEqual({ ok: true, mirrored: false });
    vi.mocked(fs.writeFileSync).mockImplementation((path, content) => {
      fsState.files.set(String(path), String(content));
    });
  });
});

describe("updateLocalModelConsent fails closed to the answer on disk", () => {
  const consentOnDisk = () =>
    JSON.parse(fsState.files.get(mod.CONFIG_PATH) ?? "{}").localEmbeddingEnabled;

  it("returns the answer on disk, not the new one, when the write fails", async () => {
    mod.readConfig();
    const fs = await import("node:fs");
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error("EACCES: permission denied");
    });

    expect(mod.updateLocalModelConsent(() => true)).toBeUndefined();
    expect(consentOnDisk()).toBeUndefined();
  });

  it("returns the no on disk and writes nothing when another process keeps the lock", () => {
    fsState.files.set(mod.CONFIG_PATH, JSON.stringify({ localEmbeddingEnabled: false }));
    fsState.files.set(`${mod.CONFIG_PATH}.lock`, "");
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 4_000));
    try {
      expect(mod.updateLocalModelConsent(() => true)).toBe(false);
    } finally {
      clock.mockRestore();
    }
    expect(consentOnDisk()).toBe(false);
  });

  it("takes its own lock once", async () => {
    const fs = await import("node:fs");
    vi.mocked(fs.openSync).mockClear();

    expect(mod.updateLocalModelConsent(() => true)).toBe(true);
    const lockTakes = vi
      .mocked(fs.openSync)
      .mock.calls.filter(([path, flag]) => flag === "wx" && path === `${mod.CONFIG_PATH}.lock`);
    expect(lockTakes).toHaveLength(1);
  });
});
