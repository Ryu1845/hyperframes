import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { CliUsageError } from "../../utils/commandResult.js";
import { createRenderPlan } from "./plan.js";

describe("createRenderPlan", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "hf-render-plan-"));
    writeFileSync(
      join(projectDir, "index.html"),
      '<main data-composition-id="main" data-width="1920" data-height="1080" data-fps="24"></main>',
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("resolves defaults once into a frozen execution plan", () => {
    const plan = createRenderPlan(
      { dir: projectDir, output: "result.mp4" },
      new Date("2026-07-10T12:34:56Z"),
    );

    expect(plan.fps).toEqual({ num: 24, den: 1 });
    expect(plan.outputPath).toBe(resolve("result.mp4"));
    expect(plan.hdrMode).toBe("auto");
    expect(plan.bestEffort).toBe(true);
    expect(plan.batchConcurrency).toBe(1);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.environment)).toBe(true);
  });

  // GIF's Netscape frame-delay field is stored in centiseconds, so fps above
  // 30 rounds to visually-indistinguishable delay values. createRenderPlan
  // clamps and flags it so the CLI console warning (present.ts) can report it.
  it("caps fps to 30 and flags it for --format gif above the ceiling", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "result.gif",
      format: "gif",
      fps: "60",
    });
    expect(plan.fps).toEqual({ num: 30, den: 1 });
    expect(plan.gifFpsCapped).toBe(true);
  });

  it("does not flag gifFpsCapped for gif fps at or below the ceiling", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "result.gif",
      format: "gif",
      fps: "24",
    });
    expect(plan.fps).toEqual({ num: 24, den: 1 });
    expect(plan.gifFpsCapped).toBe(false);
  });

  it("does not flag gifFpsCapped for non-gif formats regardless of fps", () => {
    const plan = createRenderPlan({
      dir: projectDir,
      output: "result.mp4",
      format: "mp4",
      fps: "60",
    });
    expect(plan.fps).toEqual({ num: 60, den: 1 });
    expect(plan.gifFpsCapped).toBe(false);
  });

  it("preserves an explicit strict-readiness opt-in", () => {
    const plan = createRenderPlan({ dir: projectDir, "best-effort": false });
    expect(plan.bestEffort).toBe(false);
  });

  it("preserves an aspect-agnostic resolution alias through the execution plan", () => {
    const plan = createRenderPlan({ dir: projectDir, resolution: "1080p" });
    expect(plan.outputResolution).toBe("landscape");
    expect(plan.outputResolutionAspectAgnostic).toBe(true);
    expect(plan.outputResolutionRaw).toBe("1080p");
  });

  it("classifies malformed command input as a usage error", () => {
    expect(() => createRenderPlan({ dir: projectDir, quality: "maximum" })).toThrow(CliUsageError);
  });

  it("maps looks to standard encode with CRF 16, and delivery to high", () => {
    expect(createRenderPlan({ dir: projectDir, quality: "looks" })).toMatchObject({
      quality: "standard",
      crf: 16,
    });
    expect(createRenderPlan({ dir: projectDir, quality: "delivery" })).toMatchObject({
      quality: "high",
      crf: undefined,
    });
    expect(createRenderPlan({ dir: projectDir })).toMatchObject({ quality: "standard", crf: 16 });
  });

  it("does not inject looks CRF when --crf or MOV is already set", () => {
    expect(createRenderPlan({ dir: projectDir, quality: "looks", crf: "20" }).crf).toBe(20);
    expect(
      createRenderPlan({ dir: projectDir, format: "mov", quality: "looks" }).crf,
    ).toBeUndefined();
  });

  it.each([
    ["--crf", { crf: "18" }],
    ["--video-bitrate", { "video-bitrate": "78M" }],
  ])("rejects unsupported %s rate control for ProRes MOV", (flag, encoderArgs) => {
    expect(() => createRenderPlan({ dir: projectDir, format: "mov", ...encoderArgs })).toThrow(
      CliUsageError,
    );
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(flag);
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(
      "fixed alpha-preserving ProRes 4444",
    );
  });

  it("keeps MOV quality tiers on the fixed alpha-preserving profile", () => {
    const plan = createRenderPlan({ dir: projectDir, format: "mov", quality: "high" });

    expect(plan).toMatchObject({ format: "mov", quality: "high" });
    expect(plan.crf).toBeUndefined();
    expect(plan.videoBitrate).toBeUndefined();
  });

  it("plans HLS as directory output with the default segment length", () => {
    const plan = createRenderPlan({ dir: projectDir, format: "hls" });

    expect(plan.format).toBe("hls");
    expect(plan.hlsSegmentSeconds).toBe(4);
    // No extension: outputPath is the directory the playlists are written into.
    expect(plan.outputPath.startsWith(resolve("renders", plan.project.name))).toBe(true);
    expect(basename(plan.outputPath)).not.toContain(".");
  });

  it("carries an explicit --hls-segment-seconds and rejects a fractional one", () => {
    expect(
      createRenderPlan({ dir: projectDir, format: "hls", "hls-segment-seconds": "6" })
        .hlsSegmentSeconds,
    ).toBe(6);
    expect(() =>
      createRenderPlan({ dir: projectDir, format: "hls", "hls-segment-seconds": "2.5" }),
    ).toThrow(CliUsageError);
  });

  it("leaves hlsSegmentSeconds unset for other formats", () => {
    expect(
      createRenderPlan({ dir: projectDir, format: "mp4", "hls-segment-seconds": "6" })
        .hlsSegmentSeconds,
    ).toBeUndefined();
  });

  it.each([
    ["--hdr", { hdr: true }],
    ["--gpu", { gpu: true }],
  ])("rejects %s with HLS output", (flag, conflicting) => {
    expect(() => createRenderPlan({ dir: projectDir, format: "hls", ...conflicting })).toThrow(
      CliUsageError,
    );
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toContain(flag);
  });

  it("keeps MP4 and WebM rate controls available", () => {
    expect(createRenderPlan({ dir: projectDir, format: "mp4", crf: "18" }).crf).toBe(18);
    expect(
      createRenderPlan({ dir: projectDir, format: "webm", "video-bitrate": "10M" }).videoBitrate,
    ).toBe("10M");
  });

  it("rejects batch and single-render variables before execution", () => {
    expect(() =>
      createRenderPlan({ dir: projectDir, batch: "rows.json", variables: '{"name":"Ada"}' }),
    ).toThrow(CliUsageError);
  });

  it("keeps environment changes declarative until execution", () => {
    const previous = process.env.PRODUCER_LOW_MEMORY_MODE;
    delete process.env.PRODUCER_LOW_MEMORY_MODE;
    try {
      const plan = createRenderPlan({ dir: projectDir, "low-memory-mode": true });
      expect(plan.environment).toEqual({ PRODUCER_LOW_MEMORY_MODE: "true" });
      expect(process.env.PRODUCER_LOW_MEMORY_MODE).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.PRODUCER_LOW_MEMORY_MODE;
      else process.env.PRODUCER_LOW_MEMORY_MODE = previous;
    }
  });

  it("resolves a relative frame-cache directory into the execution environment", () => {
    const plan = createRenderPlan({ dir: projectDir, "frames-cache-dir": "./frame-cache" });
    expect(plan.environment.HYPERFRAMES_EXTRACT_CACHE_DIR).toBe(resolve("./frame-cache"));
  });

  it("preserves frame-cache disable aliases for engine normalization", () => {
    const plan = createRenderPlan({ dir: projectDir, "frames-cache-dir": "OFF" });
    expect(plan.environment.HYPERFRAMES_EXTRACT_CACHE_DIR).toBe("OFF");
  });

  it("defaults the segmented resume flags off and reads --resume / --keep-segments", () => {
    const off = createRenderPlan({ dir: projectDir });
    expect(off.resumeSegments).toBe(false);
    expect(off.keepSegments).toBe(false);
    const on = createRenderPlan({ dir: projectDir, resume: true, "keep-segments": true });
    expect(on.resumeSegments).toBe(true);
    expect(on.keepSegments).toBe(true);
  });
});
