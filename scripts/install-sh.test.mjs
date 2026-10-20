import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const INSTALL_SH = new URL("../install.sh", import.meta.url);
const HOST_TARGET = {
  "darwin-arm64": "darwin-arm64",
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
}[`${process.platform}-${process.arch}`];

function release(body, { checksum } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hf-install-"));
  const asset = join(dir, `hyperframes-${HOST_TARGET}`);
  writeFileSync(asset, body);
  chmodSync(asset, 0o755);
  const sha = checksum ?? createHash("sha256").update(readFileSync(asset)).digest("hex");
  writeFileSync(`${asset}.sha256`, `${sha}  hyperframes-${HOST_TARGET}\n`);
  return dir;
}

function install(base) {
  const installDir = join(mkdtempSync(join(tmpdir(), "hf-bin-")), "bin");
  const result = spawnSync("sh", [INSTALL_SH.pathname], {
    encoding: "utf8",
    env: {
      ...process.env,
      HYPERFRAMES_DOWNLOAD_BASE: pathToFileURL(base).href,
      HYPERFRAMES_INSTALL_DIR: installDir,
    },
    timeout: 30_000,
  });
  return { ...result, installDir };
}

test("installs the host's binary after verifying its checksum", { skip: !HOST_TARGET }, () => {
  const base = release("#!/bin/sh\necho 9.9.9\n");
  const { status, stdout, stderr, installDir } = install(base);
  assert.equal(status, 0, stderr);
  assert.match(stdout, /Installed hyperframes 9\.9\.9 to .*\/bin\/hyperframes/);
  assert.match(stdout, /Add it to your PATH/);
  assert.ok(existsSync(join(installDir, "hyperframes")));
  rmSync(base, { recursive: true, force: true });
});

test("refuses a download whose checksum does not match", { skip: !HOST_TARGET }, () => {
  const base = release("#!/bin/sh\necho 9.9.9\n", { checksum: "0".repeat(64) });
  const { status, stderr, installDir } = install(base);
  assert.equal(status, 1);
  assert.match(stderr, /checksum mismatch/);
  assert.equal(existsSync(join(installDir, "hyperframes")), false);
  rmSync(base, { recursive: true, force: true });
});

test("names a missing asset", { skip: !HOST_TARGET }, () => {
  const base = mkdtempSync(join(tmpdir(), "hf-install-empty-"));
  const { status, stderr } = install(base);
  assert.equal(status, 1);
  assert.match(stderr, /could not download .*hyperframes-/);
  rmSync(base, { recursive: true, force: true });
});
