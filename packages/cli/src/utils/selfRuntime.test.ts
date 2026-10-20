import { describe, expect, it } from "vitest";
import { bunCliInvocation, scriptRunEnv, standaloneBinary } from "./selfRuntime.js";

describe("selfRuntime", () => {
  it("leaves a package or source install's child env untouched", () => {
    const env = { PATH: "/bin" };
    expect(standaloneBinary(env)).toBeUndefined();
    expect(scriptRunEnv(env)).toBe(env);
  });

  it("tells a standalone binary child to run its script", () => {
    const env = { PATH: "/bin", HYPERFRAMES_BINARY: "/opt/hyperframes" };
    expect(standaloneBinary(env)).toBe("/opt/hyperframes");
    expect(scriptRunEnv(env)).toEqual({ ...env, HF_BINARY_EXEC: "1" });
    expect(env).not.toHaveProperty("HF_BINARY_EXEC");
  });

  it("runs Bun's own CLI through the binary", () => {
    expect(bunCliInvocation("/opt/hyperframes", ["x", "--bun", "skills"], { A: "1" })).toEqual({
      command: "/opt/hyperframes",
      args: ["x", "--bun", "skills"],
      env: { A: "1", BUN_BE_BUN: "1" },
    });
  });
});
