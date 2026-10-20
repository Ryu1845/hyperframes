import { BINARY_ENV, EXEC_ENV } from "../binary/runtime.js";

/** The standalone binary's path when the CLI runs from it, else undefined. */
export function standaloneBinary(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[BINARY_ENV] || undefined;
}

/**
 * Env for a child that runs a JS file through `process.execPath`. Under the
 * standalone binary, execPath is the binary itself, which runs the CLI unless
 * told the first argument is a script.
 */
export function scriptRunEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return env[BINARY_ENV] ? { ...env, [EXEC_ENV]: "1" } : env;
}

/** Runs Bun's own CLI (e.g. `x` for bunx) through the standalone binary. */
export function bunCliInvocation(
  binary: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  return { command: binary, args: [...args], env: { ...env, BUN_BE_BUN: "1" } };
}
