import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCliInvocation } from "./cli-invocation.mjs";

const ARGV = ["transcribe", "/media/input.wav", "--dir", "/work"];
const OPTS = { stdio: ["ignore", "pipe", "pipe"], timeout: 1_800_000 };

test("runs the standalone binary that started this script", () => {
  const resolved = resolveCliInvocation(ARGV, OPTS, { HYPERFRAMES_BINARY: "/opt/hf/hyperframes" });
  assert.equal(resolved.cmd, "/opt/hf/hyperframes");
  assert.deepEqual(resolved.args, ARGV);
  assert.equal(resolved.opts, OPTS);
});

test("falls back to hyperframes on PATH", () => {
  assert.equal(resolveCliInvocation(ARGV, OPTS, {}).cmd, "hyperframes");
});
