import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { invocation, pluginVersion, versionWarning } from "./plugin-cli.mjs";

function fixture(t, manifest = "plugin.json", version = "1.2.3") {
  const root = mkdtempSync(join(tmpdir(), "hf-plugin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "skills/hyperframes/scripts/lib"), { recursive: true });
  mkdirSync(join(root, manifest, ".."), { recursive: true });
  writeFileSync(join(root, manifest), JSON.stringify({ name: "hyperframes", version }));
  const launcher = join(root, "skills/hyperframes/scripts/plugin-cli.mjs");
  copyFileSync(new URL("./plugin-cli.mjs", import.meta.url), launcher);
  copyFileSync(
    new URL("./lib/main-module.mjs", import.meta.url),
    join(root, "skills/hyperframes/scripts/lib/main-module.mjs"),
  );
  return { root, launcher };
}

for (const manifest of [
  "plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  "gemini-extension.json",
]) {
  test(`locates ${manifest} without repository packages`, (t) => {
    const { root } = fixture(t, manifest);
    assert.equal(pluginVersion(root), "1.2.3");
  });
}

test("rejects missing and floating plugin versions", (t) => {
  const { root } = fixture(t, "plugin.json", "latest");
  assert.throws(() => pluginVersion(root), /Invalid HyperFrames plugin release/);
  rmSync(join(root, "plugin.json"));
  assert.throws(() => pluginVersion(root), /No HyperFrames plugin manifest/);
});

test("runs the installed binary, suppresses standalone refresh, preserves unrelated environment", () => {
  const result = invocation(["init", "project with spaces", "--non-interactive"], {
    version: "1.2.3",
    env: { PATH: "/bin", HYPERFRAMES_SKIP_SKILLS: "0" },
  });
  assert.equal(result.command, "hyperframes");
  assert.deepEqual(result.args, ["init", "project with spaces", "--non-interactive"]);
  assert.deepEqual(result.env, {
    PATH: "/bin",
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_SKILL_PKG_VERSION: "1.2.3",
    HYPERFRAMES_PLUGIN_VERSION: "1.2.3",
  });
  assert.equal(
    invocation(["render"], { version: "1.2.3", env: { HYPERFRAMES_BINARY: "/opt/hf" } }).command,
    "/opt/hf",
  );
  assert.throws(() => invocation(["skills", "update"], { version: "1.2.3" }), /plugin manager/);
});

test("warns once when the installed binary is another release", () => {
  assert.equal(versionWarning("1.2.3", "1.2.3"), null);
  assert.match(
    versionWarning("1.2.0", "1.2.3"),
    /plugin 1\.2\.3 runs with CLI 1\.2\.0.*HYPERFRAMES_VERSION=1\.2\.3 .*install\.sh/,
  );
});

test(
  "installed launcher runs the binary on PATH with the release environment",
  { skip: process.platform === "win32" },
  (t) => {
    const { root, launcher } = fixture(t);
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "hyperframes"),
      `#!${process.execPath}\nif (process.argv[2] === "--version") { console.log("1.2.3"); process.exit(0); }\nconsole.log(JSON.stringify({ args: process.argv.slice(2), version: process.env.HYPERFRAMES_PLUGIN_VERSION })); process.exit(5);`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [launcher, "render", "a & b"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HYPERFRAMES_BINARY: "" },
    });
    assert.equal(result.status, 5, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), { args: ["render", "a & b"], version: "1.2.3" });
  },
);

test("installed helper keeps cwd, arguments, release environment and exit code", (t) => {
  const { root, launcher } = fixture(t);
  const project = join(root, "user project");
  mkdirSync(project);
  const helper = join(root, "helper.mjs");
  writeFileSync(
    helper,
    "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), skip: process.env.HYPERFRAMES_SKIP_SKILLS, version: process.env.HYPERFRAMES_SKILL_PKG_VERSION })); process.exit(7);",
  );
  const before = readFileSync(join(root, "plugin.json"), "utf8");
  const result = spawnSync(
    process.execPath,
    [launcher, "--script", helper, "literal $value & spaces"],
    { cwd: project, encoding: "utf8" },
  );
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    cwd: realpathSync(project),
    args: ["literal $value & spaces"],
    skip: "1",
    version: "1.2.3",
  });
  assert.equal(readFileSync(join(root, "plugin.json"), "utf8"), before);
});
