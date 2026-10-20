import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  getProviders,
  getProvider,
  listTypes,
  providerMatches,
  providerNamesFor,
  runProviders,
  runCapability,
} from "./registry.mjs";

// --- registry shape -------------------------------------------------------

test("listTypes exposes the v2 media types", () => {
  const types = listTypes();
  for (const t of [
    "bgm",
    "sfx",
    "image",
    "icon",
    "logo",
    "voice",
    "video",
    "brand",
    "grade",
    "lut",
  ]) {
    assert.ok(types.includes(t), `missing type: ${t}`);
  }
});

test("bgm and icon declare no provider, so a fresh resolve can only miss", async () => {
  for (const t of ["bgm", "icon"]) {
    assert.deepEqual(providerNamesFor(t), [], `${t} has no catalog provider`);
    assert.equal(await runCapability(t, "search", "x", {}), null);
    assert.equal(await runCapability(t, "generate", "x", {}), null);
  }
});

test("sanctioned providers only: Openverse, local mflux/kokoro/ltx, codex, design spec, logo tiers", () => {
  const allowed =
    /^openverse\.audio$|^bundled\.sfx$|^mflux\.local$|^kokoro\.local$|^ltx\.local$|^codex\.image_gen$|^design_spec$|^thesvg$|^github\.avatar$|^favicon\.ddg$|^color_grade\.local$|^cube_lut\.local$/;
  for (const t of listTypes()) {
    for (const p of getProviders(t)) {
      assert.ok(allowed.test(p.name), `${t} lists unsanctioned provider: ${p.name}`);
    }
  }
});

test("image cascade: local mflux, then the codex upsell", () => {
  const ps = getProviders("image");
  const names = ps.map((p) => p.name);
  assert.deepEqual(names, ["mflux.local", "codex.image_gen"]);
  const mflux = ps.find((p) => p.name === "mflux.local");
  const codex = ps.find((p) => p.name === "codex.image_gen");
  assert.ok(mflux && typeof mflux.generate === "function", "local mflux registered");
  assert.ok(codex && typeof codex.generate === "function", "codex upsell registered");
  assert.ok(names.indexOf("mflux.local") < names.indexOf("codex.image_gen"), "local before codex");
  assert.ok(!mflux.network, "local mflux is kept under --local-only");
  assert.ok(codex.network, "codex is network (skipped under --local-only)");
});

test("voice cascade: local Kokoro, kept under --local-only", () => {
  const ps = getProviders("voice");
  assert.deepEqual(
    ps.map((p) => p.name),
    ["kokoro.local"],
  );
  assert.ok(!ps[0].network, "local Kokoro kept under --local-only");
});

test("video cascade: local LTX, generate-only", async () => {
  assert.deepEqual(providerNamesFor("video"), ["ltx.local"]);
  assert.equal(providerMatches("video", "ltx.local"), true);

  const ps = getProviders("video");
  assert.ok(!ps[0].network, "local LTX is kept under --local-only");
  assert.equal(await runCapability("video", "search", "x", {}), null);
});

test("sfx cascade: Openverse first, the bundled library is the offline fallback", () => {
  const ps = getProviders("sfx");
  assert.deepEqual(
    ps.map((p) => p.name),
    ["openverse.audio", "bundled.sfx"],
  );
  assert.ok(ps[0].network, "Openverse is network-only");
  assert.ok(!ps[1].network, "bundled SFX remain available offline");
});

test("ctx.provider forces one generator (e.g. 'make an image WITH codex')", async () => {
  const providers = [
    { name: "catalog.search", network: true, search: async () => null },
    { name: "mflux.local", generate: async () => ({ hit: "local" }) },
    { name: "codex.image_gen", network: true, generate: async () => ({ hit: "codex" }) },
  ];
  // no override: local wins (first generate to return non-null)
  assert.deepEqual(await runProviders(providers, "generate", "x", {}), { hit: "local" });
  // override to codex: skip local, use codex even though local would have worked
  assert.deepEqual(await runProviders(providers, "generate", "x", { provider: "codex" }), {
    hit: "codex",
  });
  // override matches the full name too
  assert.deepEqual(
    await runProviders(providers, "generate", "x", { provider: "codex.image_gen" }),
    { hit: "codex" },
  );
  // --local-only wins even over a forced network provider: no network call,
  // clean miss (the caller surfaces the conflict). A forced LOCAL provider under
  // --local-only still runs.
  assert.equal(
    await runProviders(providers, "generate", "x", { provider: "codex", localOnly: true }),
    null,
  );
  assert.deepEqual(
    await runProviders(providers, "generate", "x", { provider: "mflux", localOnly: true }),
    { hit: "local" },
  );
});

test("getProvider returns the first provider with its type, throws for unknown", () => {
  const p = getProvider("sfx");
  assert.equal(p.type, "sfx");
  assert.equal(typeof p.search, "function");
  assert.deepEqual(getProvider("bgm"), { type: "bgm" });
  assert.throws(() => getProvider("unknown_type"), /unknown media type/);
});

test("getProviders throws for unknown type", () => {
  assert.throws(() => getProviders("nope"), /unknown media type/);
});

// --- deterministic capability execution (runProviders core) ---------------

test("runProviders calls providers in order and returns the first non-null", async () => {
  const calls = [];
  const providers = [
    {
      name: "a",
      enabled: true,
      search: async () => {
        calls.push("a");
        return null;
      },
    },
    {
      name: "b",
      enabled: true,
      search: async () => {
        calls.push("b");
        return { hit: "b" };
      },
    },
    {
      name: "c",
      enabled: true,
      search: async () => {
        calls.push("c");
        return { hit: "c" };
      },
    },
  ];
  const res = await runProviders(providers, "search", "x", {});
  assert.deepEqual(res, { hit: "b" });
  assert.deepEqual(calls, ["a", "b"], "must stop at first non-null, never call c");
});

test("runProviders skips providers missing the requested capability", async () => {
  const providers = [
    { name: "a", enabled: true /* no search */ },
    { name: "b", enabled: true, search: async () => ({ hit: "b" }) },
  ];
  const res = await runProviders(providers, "search", "x", {});
  assert.deepEqual(res, { hit: "b" });
});

test("runProviders returns null when no provider yields a result", async () => {
  const providers = [{ name: "a", enabled: true, search: async () => null }];
  assert.equal(await runProviders(providers, "search", "x", {}), null);
});

test("runCapability('bgm','process') is null — process slot is graceful when unfilled", async () => {
  assert.equal(await runCapability("bgm", "process", "x", {}), null);
});

test("--local-only skips every network provider (even free remote ones)", async () => {
  let remoteRan = false;
  const providers = [
    {
      name: "remote",
      network: true,
      search: async () => {
        remoteRan = true;
        return { hit: "net" };
      },
    },
    { name: "local", search: async () => ({ hit: "local" }) },
  ];
  assert.deepEqual(await runProviders(providers, "search", "x", { localOnly: true }), {
    hit: "local",
  });
  assert.equal(remoteRan, false, "the remote provider must not be called offline");
});
