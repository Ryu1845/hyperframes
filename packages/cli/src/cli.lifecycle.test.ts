import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = [...process.argv];
const originalExitCode = process.exitCode;

afterEach(() => {
  process.argv = [...originalArgv];
  process.exitCode = originalExitCode;
  vi.doUnmock("./commands/init.js");
  vi.resetModules();
});

describe("CLI lifecycle", () => {
  it("exits 0 on an EPIPE after a validated render", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      mockInitCommand(() => emitStreamEpipe());

      const successState = await import("./utils/render-success-state.js");
      successState.markRenderSucceeded();
      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      // The pipe closing after the artifact was validated is a normal agent teardown.
      expect(exitSpy).toHaveBeenCalledWith(0);
      successState._resetRenderSuccessForTests();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("does not let pre-artifact noise fail a run whose render later validates", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const successState = await import("./utils/render-success-state.js");
      // Noise arrives BEFORE the artifact is validated (mid-render EPIPE /
      // stray rejection shape), then the render completes and validates.
      mockInitCommand(() => {
        emitStreamEpipe();
        successState.markRenderSucceeded();
      });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(process.exitCode).toBe(0);
      successState._resetRenderSuccessForTests();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("does not let a pre-validation unhandledRejection fail a validated render", async () => {
    // The unhandledRejection handler deliberately does NOT exit, so a stray
    // rejection mid-render sets exitCode 1, the render then completes and
    // validates, and finalizeCli writes exit code 0.
    // Detach the test runner's own unhandledRejection listeners so the
    // synthetic emit reaches only the CLI's handler, then restore them.
    const priorListeners = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    try {
      const successState = await import("./utils/render-success-state.js");
      mockInitCommand(() => {
        process.emit("unhandledRejection", new Error("stray teardown noise"), Promise.resolve());
        successState.markRenderSucceeded();
      });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(process.exitCode).toBe(0);
      successState._resetRenderSuccessForTests();
    } finally {
      process.removeAllListeners("unhandledRejection");
      for (const listener of priorListeners) process.on("unhandledRejection", listener);
    }
  });

  it("does not let a post-validation throw fail a render whose artifact is on disk", async () => {
    // A teardown step throws AFTER the artifact validated, the command wrapper
    // catches it, and the result carries exitCode 1. A caught throw never
    // reaches the process handlers, so finalizeCli has to sanitize the code.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    try {
      const successState = await import("./utils/render-success-state.js");
      mockInitCommand(() => {
        successState.markRenderSucceeded();
        throw new Error("post-render teardown blew up");
      });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(process.exitCode).toBe(0);
      successState._resetRenderSuccessForTests();
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("still exits non-zero when a command throws and no render ever validated", async () => {
    // The guard on the sanitizer above: it must key off a validated artifact,
    // not merely off the command having finished.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockInitCommand(() => {
        throw new Error("genuine failure");
      });

      process.argv = ["node", "cli.ts", "init", "--json"];
      await import("./cli.js");

      expect(process.exitCode).not.toBe(0);
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

function mockInitCommand(run: () => void | Promise<void>): void {
  vi.doMock("./commands/init.js", () => ({
    default: {
      meta: { name: "init" },
      args: { json: { type: "boolean" } },
      run,
    },
  }));
}

function emitStreamEpipe(): void {
  process.stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
}
