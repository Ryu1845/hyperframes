import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const config = parse(workflow);
const prepare = config.jobs.prepare;
const versionGate = prepare.steps.find(
  (step) => step.name === "Require the tag to match the package version",
);

function runVersionGate(tag, packageVersion) {
  const root = mkdtempSync(join(tmpdir(), "hyperframes-release-gate-test-"));
  try {
    mkdirSync(join(root, "packages", "cli"), { recursive: true });
    writeFileSync(
      join(root, "packages", "cli", "package.json"),
      JSON.stringify({ version: packageVersion }),
    );
    execFileSync("git", ["init", "-q"], { cwd: root, timeout: 5_000 });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t.invalid",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "r",
      ],
      { cwd: root, timeout: 5_000 },
    );
    return spawnSync("bash", ["-euo", "pipefail", "-c", versionGate.run], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, TAG: tag },
      timeout: 5_000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("publishing a release, or a manual re-run for its tag, is the only trigger", () => {
  assert.deepEqual(Object.keys(config.on).sort(), ["release", "workflow_dispatch"]);
  assert.deepEqual(config.on.release.types, ["published"]);
  assert.equal(config.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(prepare.env.TAG, "${{ github.event.release.tag_name || inputs.tag }}");
  const checkout = prepare.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "refs/tags/${{ env.TAG }}");
});

test("the release tag must match the package version", () => {
  assert.ok(versionGate);
  assert.equal(versionGate.if, undefined);
  assert.equal(versionGate["continue-on-error"], undefined);

  const match = runVersionGate("v9.8.7", "9.8.7");
  assert.equal(match.status, 0, `${match.stdout}\n${match.stderr}`);
  assert.match(match.stdout, /Releasing 9\.8\.7 from [0-9a-f]{40}/);

  const mismatch = runVersionGate("v9.8.8", "9.8.7");
  assert.equal(mismatch.status, 1, `${mismatch.stdout}\n${mismatch.stderr}`);
  assert.match(mismatch.stdout, /packages\/cli\/package\.json is 9\.8\.7/);
  assert.match(mismatch.stdout, /bun run set-version 9\.8\.8 --no-tag/);
});

test("releases ship standalone binaries for every target and nothing goes to npm", () => {
  const binaries = config.jobs.binaries;
  assert.equal(binaries.needs, "prepare");
  const checkout = binaries.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "${{ needs.prepare.outputs.sha }}");
  assert.deepEqual(
    binaries.strategy.matrix.include.map((entry) => entry.target),
    ["darwin-arm64", "linux-x64", "linux-arm64"],
  );
  const steps = binaries.steps.map((step) => step.run ?? "").join("\n");
  assert.match(steps, /build-binary\.ts --target \$\{\{ matrix\.target \}\}/);
  assert.match(steps, /binary-smoke\.sh packages\/cli\/\.binary\/hyperframes-/);
  assert.match(steps, /gh release upload "\$TAG"/);
  assert.doesNotMatch(workflow, /npm publish|NODE_AUTH_TOKEN|NPM_TOKEN|registry-url/);
  assert.equal(prepare.environment, undefined);
});
