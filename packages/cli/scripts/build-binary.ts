// Builds the standalone CLI binary for the host platform with `bun build --compile`.
//
// The binary is Bun plus a gzipped tar of what a package install of the CLI
// produces: the packed CLI (bin + dist) and its production node_modules, with the
// optional native packages pinned beside it so nothing installs on first use.
// src/binary/launcher.ts unpacks it once and runs the CLI from disk.
//
// Run after `bun run build`:
//   bun packages/cli/scripts/build-binary.ts [--target <os>-<arch>]
// The target defaults to the host. Another target installs that platform's
// native packages (bun install --os/--cpu), so it builds but cannot be smoke-tested
// here. Output: packages/cli/.binary/hyperframes-<target> and its .sha256.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_PACKAGES } from "../src/utils/optionalPackages.ts";
import { sherpaPlatformPackage } from "../src/whisper/sherpa.ts";

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(CLI_ROOT, ".binary");
const STAGE = join(OUT, "stage");
const ROOT = join(STAGE, "root");

/** Host platform → Bun compile target. Baseline x64 runs under Rosetta and qemu. */
const BUN_TARGETS: Record<string, string> = {
  "darwin-arm64": "bun-darwin-arm64",
  "linux-x64": "bun-linux-x64-baseline",
  "linux-arm64": "bun-linux-arm64",
};

function run(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  return execFileSync(command, args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function splitSpec(spec: string): [string, string] {
  const at = spec.lastIndexOf("@");
  return [spec.slice(0, at), spec.slice(at + 1)];
}

/** Version the workspace resolved for `name`, so the staged install matches bun.lock. */
function workspaceVersion(name: string): string {
  const req = createRequire(join(CLI_ROOT, "package.json"));
  const dir = (req.resolve.paths(name) ?? [])
    .map((base) => join(base, name))
    .find((candidate) => existsSync(join(candidate, "package.json")));
  if (!dir) throw new Error(`${name} is not installed in the workspace; run bun install first`);
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string })
    .version;
}

function walk(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, visit);
    else visit(path);
  }
}

/** Other platforms' onnxruntime builds and its GPU providers never load here. */
// fallow-ignore-next-line complexity
function pruneOnnxruntime(platform: string, arch: string): void {
  const bin = join(ROOT, "node_modules", "onnxruntime-node", "bin", "napi-v3");
  if (!existsSync(bin)) return;
  for (const os of readdirSync(bin)) {
    if (os !== platform) rmSync(join(bin, os), { recursive: true });
    else {
      for (const cpu of readdirSync(join(bin, os))) {
        if (cpu !== arch) rmSync(join(bin, os, cpu), { recursive: true });
      }
    }
  }
  walk(bin, (path) => {
    if (/providers_(cuda|tensorrt)/.test(path)) rmSync(path);
  });
}

/** Both libc builds of sharp install on Linux; a glibc host never loads the musl one. */
// fallow-ignore-next-line complexity
function pruneMuslSharp(platform: string): void {
  const img = join(ROOT, "node_modules", "@img");
  if (platform !== "linux" || !existsSync(img)) return;
  for (const pkg of readdirSync(img)) {
    if (pkg.includes("linuxmusl")) rmSync(join(img, pkg), { recursive: true });
  }
}

function prune(target: string): void {
  const [platform = "", arch = ""] = target.split("-");
  pruneOnnxruntime(platform, arch);
  pruneMuslSharp(platform);
  walk(join(ROOT, "node_modules"), (path) => {
    if (/\.(map|d\.ts|d\.mts|d\.cts)$/.test(path)) rmSync(path);
  });
}

/** `--target <os>-<arch>`, or the host, with its Bun compile target. */
function resolveTarget(argv: string[]): { target: string; bunTarget: string } {
  const flag = argv.indexOf("--target");
  const target = flag === -1 ? `${process.platform}-${process.arch}` : (argv[flag + 1] ?? "");
  const bunTarget = BUN_TARGETS[target];
  if (bunTarget) return { target, bunTarget };
  throw new Error(
    `No standalone binary target for ${target}; supported: ${Object.keys(BUN_TARGETS).join(", ")}`,
  );
}

function main(): void {
  const { target, bunTarget } = resolveTarget(process.argv);
  const [os = "", cpu = ""] = target.split("-");
  if (!existsSync(join(CLI_ROOT, "dist", "cli.js"))) {
    throw new Error("packages/cli/dist is missing; run `bun run build` first");
  }

  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });

  run("bun", ["pm", "pack", "--destination", STAGE, "--ignore-scripts", "--quiet"], CLI_ROOT);
  const tarball = readdirSync(STAGE).find((name) => name.endsWith(".tgz"));
  if (!tarball) throw new Error("bun pm pack produced no tarball");

  const cliManifest = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8")) as {
    version: string;
    dependencies: Record<string, string>;
  };
  const overrides = Object.fromEntries(
    Object.keys(cliManifest.dependencies).map((name) => [name, workspaceVersion(name)]),
  );
  const [sherpaNative, sherpaNativeVersion] = splitSpec(sherpaPlatformPackage(os, cpu));
  writeFileSync(
    join(ROOT, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        dependencies: {
          "@hyperframes/cli": `file:../${tarball}`,
          ...PINNED_PACKAGES,
          [sherpaNative]: sherpaNativeVersion,
        },
        overrides,
      },
      null,
      2,
    )}\n`,
  );
  run(
    "bun",
    [
      "install",
      "--production",
      "--linker=hoisted",
      "--ignore-scripts",
      "--no-progress",
      `--os=${os}`,
      `--cpu=${cpu}`,
    ],
    ROOT,
    { ...process.env, ONNXRUNTIME_NODE_INSTALL_CUDA: "skip" },
  );
  prune(target);

  mkdirSync(OUT, { recursive: true });
  const payload = join(OUT, "payload.tar.gz");
  const contents = ["node_modules", "package.json", "bun.lock"].filter((name) =>
    existsSync(join(ROOT, name)),
  );
  run("tar", ["-czf", payload, "-C", ROOT, ...contents], CLI_ROOT);
  const payloadSha = sha256(payload);

  const binaryName = `hyperframes-${target}`;
  const binary = join(OUT, binaryName);
  run(
    "bun",
    [
      "build",
      "--compile",
      `--target=${bunTarget}`,
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--compile-autoload-package-json",
      `--define=__HF_BINARY_VERSION__=${JSON.stringify(cliManifest.version)}`,
      `--define=__HF_PAYLOAD_SHA__=${JSON.stringify(payloadSha)}`,
      "src/binary/launcher.ts",
      "--outfile",
      binary,
    ],
    CLI_ROOT,
  );
  writeFileSync(`${binary}.sha256`, `${sha256(binary)}  ${binaryName}\n`);

  const mb = (path: string) => `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
  console.log(`${binaryName}: ${mb(binary)} (payload ${mb(payload)})`);
}

main();
