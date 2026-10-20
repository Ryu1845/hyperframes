import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFromDir } from "./env.mjs";

test("loadEnvFromDir skips a .env folder and loads the .env file above it", () => {
  const root = mkdtempSync(join(tmpdir(), "media-use-env-"));
  const project = join(root, "project");
  mkdirSync(join(project, ".env"), { recursive: true });
  writeFileSync(join(root, ".env"), "MEDIA_USE_ENV_DIR_TEST=from-parent\n");
  try {
    loadEnvFromDir(project);
    assert.equal(process.env.MEDIA_USE_ENV_DIR_TEST, "from-parent");
  } finally {
    delete process.env.MEDIA_USE_ENV_DIR_TEST;
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadEnvFromDir never overrides a variable the shell already set", () => {
  const project = mkdtempSync(join(tmpdir(), "media-use-env-"));
  writeFileSync(
    join(project, ".env"),
    'export MEDIA_USE_ENV_SHELL_TEST="from-file"\nMEDIA_USE_ENV_NEW_TEST=loaded\n',
  );
  try {
    process.env.MEDIA_USE_ENV_SHELL_TEST = "from-shell";
    loadEnvFromDir(project);
    assert.equal(process.env.MEDIA_USE_ENV_SHELL_TEST, "from-shell");
    assert.equal(process.env.MEDIA_USE_ENV_NEW_TEST, "loaded");
  } finally {
    delete process.env.MEDIA_USE_ENV_SHELL_TEST;
    delete process.env.MEDIA_USE_ENV_NEW_TEST;
    rmSync(project, { recursive: true, force: true });
  }
});
