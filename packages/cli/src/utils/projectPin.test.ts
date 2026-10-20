import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let runningVersion = "0.7.55";
vi.mock("../version.js", () => ({
  get VERSION() {
    return runningVersion;
  },
}));
// isDevMode() is true under vitest (module path ends in .ts), which would
// suppress the notice unconditionally.
vi.mock("./env.js", () => ({ isDevMode: () => false }));

import {
  HYPERFRAMES_PIN_RE,
  printOlderThanPinNotice,
  readPinnedHyperframesVersions,
} from "./projectPin.js";

describe("HYPERFRAMES_PIN_RE", () => {
  it("matches a hyperframes@<semver> token and captures the version", () => {
    const match = "npx --yes @ryu1845/hyperframes@1.2.3 render".match(HYPERFRAMES_PIN_RE);
    expect(match?.[0]).toBe("hyperframes@1.2.3");
  });
});

describe("readPinnedHyperframesVersions", () => {
  it("reads distinct pinned versions across scripts", () => {
    expect(
      readPinnedHyperframesVersions({
        a: "npx --yes @ryu1845/hyperframes@0.7.48 render",
        b: "npx @ryu1845/hyperframes@0.7.50 check",
        c: "npx @ryu1845/hyperframes render",
      }),
    ).toEqual(["0.7.48", "0.7.50"]);
  });
});

describe("printOlderThanPinNotice", () => {
  let dir: string;
  let writes: string[];
  const origWrite = process.stderr.write.bind(process.stderr);
  beforeEach(() => {
    runningVersion = "0.7.55";
    writes = [];
    dir = mkdtempSync(join(tmpdir(), "hf-pin-"));
    process.stderr.write = ((s: unknown) => {
      writes.push(String(s));
      return true;
    }) as typeof process.stderr.write;
    delete process.env.CI;
  });
  afterEach(() => {
    process.stderr.write = origWrite;
    rmSync(dir, { recursive: true, force: true });
  });

  it("warns on every run when an older CLI than the pin is running", () => {
    runningVersion = "0.7.71";
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { check: "npx --yes @ryu1845/hyperframes@0.8.66 check" } }),
    );
    printOlderThanPinNotice(dir);
    printOlderThanPinNotice(dir);
    const mismatch = writes.filter((w) => w.includes("This is hyperframes 0.7.71"));
    expect(mismatch.length).toBe(2);
    expect(mismatch[0]).toContain("npx @ryu1845/hyperframes@0.8.66");
  });

  it("is silent when the pin is not newer than the running CLI", () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { render: "npx --yes @ryu1845/hyperframes@0.7.48 render" } }),
    );
    printOlderThanPinNotice(dir);
    expect(writes.join("")).toBe("");
  });

  it("is silent under CI", () => {
    process.env.CI = "true";
    runningVersion = "0.7.0";
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { render: "npx --yes @ryu1845/hyperframes@0.7.48 render" } }),
    );
    printOlderThanPinNotice(dir);
    expect(writes.join("")).toBe("");
  });
});
