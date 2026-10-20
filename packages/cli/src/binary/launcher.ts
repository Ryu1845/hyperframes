// Entry point of the standalone `bun build --compile` binary. Not part of the
// tsup build: packages/cli/scripts/build-binary.ts compiles it with the payload.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import payloadPath from "../../.binary/payload.tar.gz" with { type: "file" };
import {
  BINARY_ENV,
  EXEC_ENV,
  RUNTIME_ROOT_ENV,
  cliEntry,
  ensureRuntime,
  pruneRuntimes,
  runtimeDirName,
  runtimeParent,
} from "./runtime.js";

declare const __HF_BINARY_VERSION__: string;
declare const __HF_PAYLOAD_SHA__: string;

const parent = runtimeParent();
const name = runtimeDirName(__HF_BINARY_VERSION__, __HF_PAYLOAD_SHA__);
const root = join(parent, name);
ensureRuntime(root, () => readFileSync(payloadPath));

if (process.env[EXEC_ENV]) {
  // A child the CLI started with process.execPath: run its script, not the CLI.
  // Clearing the flag keeps grandchildren that launch `hyperframes` on the CLI.
  delete process.env[EXEC_ENV];
  const [argv0 = "hyperframes", , target = "", ...rest] = process.argv;
  if (target === "-e") {
    const run = new Function("require", rest[0] ?? "");
    run(createRequire(join(process.cwd(), "[eval]")));
  } else {
    process.argv = [argv0, target, ...rest];
    await import(pathToFileURL(target).href);
  }
} else {
  pruneRuntimes(parent, name);
  process.env[BINARY_ENV] = process.execPath;
  process.env[RUNTIME_ROOT_ENV] = root;
  const entry = cliEntry(root);
  process.argv = [process.argv[0] ?? "hyperframes", entry, ...process.argv.slice(2)];
  await import(pathToFileURL(entry).href);
}
