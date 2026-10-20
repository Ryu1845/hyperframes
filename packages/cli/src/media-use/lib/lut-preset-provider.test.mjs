import { strict as assert } from "node:assert";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  LIBRARY_LUT_OFFLINE_CODE,
  RESOLVABLE_PRESET_IDS,
  freezeLibraryLut,
  matchColorLook,
  readBundledLutIndex,
} from "./lut-preset-provider.mjs";
import { buildCube } from "./cube-build.mjs";
import { validateCube, validateCubeFile } from "./cube-validate.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

function corePresetIdsFromSource() {
  const src = readFileSync(join(REPO_ROOT, "packages/core/src/colorGrading.ts"), "utf8");
  const match = src.match(/export type HfColorGradingPresetId =([\s\S]*?);/);
  assert.ok(match, "core preset union should be readable");
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("warm daylight and warm natural light resolve to the core warm-daylight preset", () => {
  assert.deepEqual(matchColorLook("warm daylight"), {
    kind: "preset",
    preset: "warm-daylight",
    score: 2,
  });
  assert.equal(matchColorLook("warm natural light").preset, "warm-daylight");
});

test("high contrast punchy resolves to deep-contrast", () => {
  assert.equal(matchColorLook("high contrast punchy").preset, "deep-contrast");
});

test("removed preset phrases resolve to surviving looks", () => {
  assert.equal(matchColorLook("natural lift").preset, "soft-boost");
  assert.equal(matchColorLook("fresh pop").preset, "bright-pop");
  assert.equal(matchColorLook("warm clean").preset, "warm-daylight");
  assert.equal(matchColorLook("cool clean").preset, "clean-studio");
});

test("complete-filter intent aliases resolve deterministically", () => {
  assert.equal(matchColorLook("analog tape").preset, "vhs-playback");
  assert.equal(matchColorLook("creator video").preset, "creator-camcorder");
});

test("a bundled library look freezes a validated cube from params without the network", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "mu-lut-provider-"));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error("a bundled look must not download anything");
    };
    const match = matchColorLook("teal orange blockbuster");
    assert.equal(match.kind, "library");
    assert.equal(match.url, undefined);
    for (const localOnly of [false, true]) {
      const frozen = await freezeLibraryLut(match, { projectDir, type: "grade", localOnly });
      assert.match(frozen.localPath, /^\.media\/luts\/grade_00\d\.cube$/);
      assert.ok(existsSync(join(projectDir, frozen.localPath)));
      assert.equal(validateCubeFile(join(projectDir, frozen.localPath)).ok, true);
      assert.equal(frozen.lut.src, frozen.localPath);
      assert.equal(frozen.metadata.provenance.via, "params");
    }
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("every resolver preset exists in packages/core/src/colorGrading.ts", () => {
  const corePresetIds = corePresetIdsFromSource();
  assert.deepEqual(
    RESOLVABLE_PRESET_IDS.filter((id) => !corePresetIds.includes(id)),
    [],
  );
  for (const id of RESOLVABLE_PRESET_IDS) {
    const match = matchColorLook(id);
    assert.equal(match.kind, "preset");
    assert.equal(match.preset, id);
  }
});

test("zero-overlap intent returns no preset or library match", () => {
  assert.equal(matchColorLook("zqxv imaginary neutron look"), null);
});

test("bundled LUT index entries resolve from params alone", () => {
  const entries = readBundledLutIndex();
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.ok(entry.id);
    assert.ok(entry.description);
    assert.equal(entry.url, undefined, `${entry.id} should not depend on a hosted .cube`);
    assert.equal(typeof entry.params, "object", `${entry.id} should define params`);
    assert.equal(validateCube(buildCube(entry.params)).ok, true, `${entry.id} params validate`);
  }
});

test("url library entries respect localOnly and freeze through fetch", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "mu-lut-url-provider-"));
  const match = {
    kind: "library",
    id: "hosted-look",
    description: "Hosted look",
    tags: ["hosted"],
    intensity: 0.7,
    url: "https://example.invalid/look.cube",
  };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  try {
    globalThis.fetch = async () => {
      fetchCalls++;
      throw new Error("network should be skipped under localOnly");
    };
    await assert.rejects(
      freezeLibraryLut(match, { projectDir, type: "lut", localOnly: true }),
      (err) => {
        assert.equal(err.code, LIBRARY_LUT_OFFLINE_CODE);
        assert.match(err.message, /--local-only/);
        return true;
      },
    );
    assert.equal(fetchCalls, 0);

    const cube = buildCube({ contrast: 0.1 });
    const body = Buffer.from(cube);
    globalThis.fetch = async (url) => {
      fetchCalls++;
      assert.equal(url, match.url);
      const directory = join(projectDir, ".media/luts");
      const staging = readdirSync(directory).filter((name) => name.startsWith(".lut-download-"));
      assert.equal(staging.length, 1);
      if (process.platform !== "win32") {
        assert.equal(statSync(join(directory, staging[0])).mode & 0o777, 0o700);
      }
      const victim = join(projectDir, "victim.cube");
      writeFileSync(victim, "unchanged");
      symlinkSync(victim, join(directory, "lut_001.cube.tmp"));
      return {
        ok: true,
        headers: { get: () => String(body.length) },
        body: [body],
      };
    };

    const frozen = await freezeLibraryLut(match, { projectDir, type: "lut" });
    assert.equal(fetchCalls, 1);
    assert.match(frozen.localPath, /^\.media\/luts\/lut_001\.cube$/);
    assert.equal(validateCubeFile(join(projectDir, frozen.localPath)).ok, true);
    assert.equal(frozen.metadata.provenance.via, "url");
    assert.equal(readFileSync(join(projectDir, "victim.cube"), "utf8"), "unchanged");
    assert.deepEqual(readdirSync(join(projectDir, ".media/luts")).sort(), [
      "lut_001.cube",
      "lut_001.cube.tmp",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test("failed URL library freeze releases its reservation", async () => {
  const projectDir = mkdtempSync(join(tmpdir(), "mu-lut-failure-"));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      headers: { get: () => "12" },
      body: [Buffer.from("not a cube\n")],
    });
    await assert.rejects(
      freezeLibraryLut(
        {
          kind: "library",
          id: "broken-hosted-look",
          description: "Broken hosted look",
          tags: ["broken"],
          intensity: 1,
          url: "https://example.com/broken.cube",
        },
        { projectDir, type: "lut" },
      ),
      /failed to freeze library LUT/,
    );
    assert.deepStrictEqual(readdirSync(join(projectDir, ".media/luts")), []);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(projectDir, { recursive: true, force: true });
  }
});
