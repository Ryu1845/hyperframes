import { test } from "node:test";
import assert from "node:assert/strict";
import { localTtsGenerate } from "./tts-local-provider.mjs";

// Kokoro runs through the hyperframes binary: the one that started this script,
// else the one on PATH. The fake exec synthesizes nothing, so the provider
// returns null via the missing-output check; only the spawn shape is asserted.

test("runs `hyperframes tts` through the standalone binary that started the script", async () => {
  const captured = [];
  const fakeExec = (cmd, args, opts) => captured.push({ cmd, args, opts });

  await localTtsGenerate("hello there", { voice: "am_michael" }, fakeExec, {
    HYPERFRAMES_BINARY: "/opt/hf/hyperframes",
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "/opt/hf/hyperframes");
  assert.deepEqual(captured[0].args.slice(0, 2), ["tts", "hello there"]);
  assert.ok(captured[0].args.includes("--voice"));
  // Pipes are what let the caller read the "kokoro-onnx not installed" hint back out.
  assert.deepEqual(captured[0].opts.stdio, ["ignore", "pipe", "pipe"]);
});

test("falls back to hyperframes on PATH and forwards a non-English language", async () => {
  const captured = [];
  const fakeExec = (cmd, args) => captured.push({ cmd, args });

  const result = await localTtsGenerate("hola", { lang: "es" }, fakeExec, {});

  assert.equal(result, null);
  assert.equal(captured[0].cmd, "hyperframes");
  assert.deepEqual(captured[0].args.slice(0, 2), ["tts", "hola"]);
  assert.ok(captured[0].args.includes("--lang"));
});
