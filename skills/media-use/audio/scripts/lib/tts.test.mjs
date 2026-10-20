import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import {
  parseFfmpegDurationBanner,
  ffprobeDuration,
  synthesizeOne,
  synthResult,
  pickProvider,
  resolveVoiceId,
} from "./tts.mjs";

test("parseFfmpegDurationBanner reads ffmpeg's stderr Duration line", () => {
  const stderr = [
    "ffmpeg version 6.0",
    "Input #0, wav, from 'a.wav':",
    "  Duration: 00:00:03.42, bitrate: 705 kb/s",
    "At least one output file must be specified",
  ].join("\n");
  assert.equal(parseFfmpegDurationBanner(stderr), 3.42);
});

test("parseFfmpegDurationBanner handles an hours component", () => {
  const stderr = "  Duration: 01:02:03.50, start: 0.000000, bitrate: 128 kb/s";
  assert.equal(parseFfmpegDurationBanner(stderr), 3723.5);
});

test("parseFfmpegDurationBanner returns NaN when there is no Duration line", () => {
  assert.ok(Number.isNaN(parseFfmpegDurationBanner("ffmpeg: command not found")));
  assert.ok(Number.isNaN(parseFfmpegDurationBanner("")));
  assert.ok(Number.isNaN(parseFfmpegDurationBanner(undefined)));
});

// Regression for the actual bug: ffprobeDuration used to collapse "ffprobe
// binary is missing" (ENOENT — the "essentials"-style Windows ffmpeg build
// with no ffprobe.exe) and "file is genuinely unreadable" into the same NaN,
// giving audio.mjs no way to tell "measure differently" from "give up".
//
// Builds an isolated PATH containing only a fake `ffmpeg` stub (no `ffprobe`
// at all) so ffprobeDuration's spawnSync("ffprobe", ...) call ENOENTs for
// real, then verifies it recovers the duration via the ffmpeg fallback
// instead of returning NaN.
test("ffprobeDuration falls back to ffmpeg when the ffprobe binary itself is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-ffprobe-fallback-"));
  const fakeFfmpeg = join(dir, "ffmpeg");
  writeFileSync(
    fakeFfmpeg,
    "#!/bin/sh\necho 'Duration: 00:00:02.50, start: 0.000000, bitrate: 128 kb/s' 1>&2\nexit 1\n",
  );
  chmodSync(fakeFfmpeg, 0o755);
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = dir; // only the fake ffmpeg resolves; no real ffprobe on this PATH
    assert.equal(ffprobeDuration("/does/not/matter.wav"), 2.5);
  } finally {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ffprobeDuration returns NaN when neither ffprobe nor ffmpeg resolve", () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-no-binaries-"));
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = dir; // empty directory — nothing resolves
    assert.ok(Number.isNaN(ffprobeDuration("/does/not/matter.wav")));
  } finally {
    process.env.PATH = originalPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthesizeOne(elevenlabs) creates the output dir before writing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tts-el-mkdir-"));
  const wavAbs = join(dir, "assets", "voice", "line-0.wav"); // nested, not yet created
  const savedKey = process.env.ELEVENLABS_API_KEY;
  try {
    // Unset the key so the Python side fails fast — the mkdir must run before
    // the spawn regardless, which is what this guards.
    delete process.env.ELEVENLABS_API_KEY;
    await synthesizeOne({
      provider: "elevenlabs",
      text: "hi",
      voiceId: "v",
      wavAbs,
      hyperframesDir: dir,
    });
    assert.ok(existsSync(dirname(wavAbs)), "output directory should be created");
  } finally {
    if (savedKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = savedKey;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("synthResult names a non-zero subprocess exit", () => {
  const res = synthResult({ status: 2 }, "/tmp/none.wav", "kokoro (hyperframes tts)");
  assert.equal(res.ok, false);
  assert.match(res.error, /kokoro .* exited with status 2/);
});

// Kokoro shells out to `hyperframes tts`; a fake hyperframes on PATH records the argv
// synthesizeOne really builds, so a dropped flag fails here. The stub is a shell
// script, so Windows skips it.
async function kokoroArgv(options) {
  const dir = mkdtempSync(join(tmpdir(), "tts-kokoro-argv-"));
  const argvLog = join(dir, "argv.txt");
  writeFileSync(join(dir, "hyperframes"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvLog}"\n`);
  chmodSync(join(dir, "hyperframes"), 0o755);
  const originalPath = process.env.PATH;
  const originalBinary = process.env.HYPERFRAMES_BINARY;
  try {
    process.env.PATH = dir;
    delete process.env.HYPERFRAMES_BINARY;
    await synthesizeOne({
      provider: "kokoro",
      text: "hi",
      voiceId: "am_michael",
      wavAbs: join(dir, "line-0.wav"),
      hyperframesDir: dir,
      ...options,
    });
    return readFileSync(argvLog, "utf8").trim().split("\n");
  } finally {
    process.env.PATH = originalPath;
    if (originalBinary !== undefined) process.env.HYPERFRAMES_BINARY = originalBinary;
    rmSync(dir, { recursive: true, force: true });
  }
}

test(
  "synthesizeOne(kokoro) forwards a non-default speed to the CLI",
  { skip: process.platform === "win32" },
  async () => {
    const argv = await kokoroArgv({ speed: 0.8, lang: "es" });
    assert.deepEqual(argv.slice(-4), ["--lang", "es", "--speed", "0.8"]);
  },
);

test(
  "synthesizeOne(kokoro) leaves --speed off at the default",
  { skip: process.platform === "win32" },
  async () => {
    assert.ok(!(await kokoroArgv({})).includes("--speed"));
  },
);

test("pickProvider refuses a provider the engine no longer has, naming the valid ones", () => {
  assert.throws(
    () => pickProvider("bogus"),
    /invalid provider "bogus" \(elevenlabs \| kokoro \| gemini\)/,
  );
});

test("pickProvider auto-selects Kokoro when no ElevenLabs key is set", () => {
  const saved = process.env.ELEVENLABS_API_KEY;
  try {
    delete process.env.ELEVENLABS_API_KEY;
    assert.equal(pickProvider(null), "kokoro");
  } finally {
    if (saved !== undefined) process.env.ELEVENLABS_API_KEY = saved;
  }
});

test("resolveVoiceId gives each provider a fixed default and Kokoro needs a voice off English", async () => {
  assert.equal(await resolveVoiceId({ provider: "kokoro", lang: "en" }), "am_michael");
  assert.equal(await resolveVoiceId({ provider: "elevenlabs" }), "21m00Tcm4TlvDq8ikWAM");
  assert.equal(await resolveVoiceId({ provider: "gemini" }), "Kore");
  assert.equal(await resolveVoiceId({ provider: "kokoro", userVoice: "bf_emma" }), "bf_emma");
  await assert.rejects(resolveVoiceId({ provider: "kokoro", lang: "fr" }), /explicit --voice/);
});
