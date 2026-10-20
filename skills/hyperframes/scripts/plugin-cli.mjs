#!/usr/bin/env node
// Run from the user's project; locate the release from this installed file.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./lib/main-module.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifests = [
  "plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".cursor-plugin/plugin.json",
  "gemini-extension.json",
];

export function pluginVersion(pluginRoot = root) {
  for (const path of manifests) {
    const file = join(pluginRoot, path);
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    if (
      manifest.name !== "hyperframes" ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version ?? "")
    ) {
      throw new Error(`Invalid HyperFrames plugin release: ${file}`);
    }
    return manifest.version;
  }
  throw new Error(
    "No HyperFrames plugin manifest found. Use the standalone skills installation instructions.",
  );
}

export function invocation(args, { version = pluginVersion(), env = process.env } = {}) {
  if (args[0] === "skills")
    throw new Error(
      "Update HyperFrames through your agent's plugin manager; bundled skills are release-managed.",
    );
  const childEnv = {
    ...env,
    HYPERFRAMES_SKIP_SKILLS: "1",
    HYPERFRAMES_SKILL_PKG_VERSION: version,
    HYPERFRAMES_PLUGIN_VERSION: version,
  };
  if (args[0] === "--script") {
    if (!args[1]) throw new Error("--script requires a Node script path.");
    return { command: process.execPath, args: args.slice(1), env: childEnv };
  }
  // The CLI ships as a standalone binary, installed by install.sh onto PATH.
  return { command: env.HYPERFRAMES_BINARY || "hyperframes", args: [...args], env: childEnv };
}

const INSTALL_HINT = (version) =>
  `HYPERFRAMES_VERSION=${version} sh -c "$(curl -fsSL https://raw.githubusercontent.com/ryu1845/hyperframes/main/install.sh)"`;

/** One line when the installed binary is not the release this plugin was built with. */
export function versionWarning(installed, expected) {
  if (installed === expected) return null;
  return `HyperFrames plugin ${expected} runs with CLI ${installed}. To match it: ${INSTALL_HINT(expected)}`;
}

if (isMainModule(import.meta.url)) {
  try {
    const command = invocation(process.argv.slice(2));
    if (command.command !== process.execPath) {
      const probe = spawnSync(command.command, ["--version"], { encoding: "utf8" });
      if (probe.error) {
        throw new Error(
          `The hyperframes CLI is not installed (${probe.error.message}). Install it:\n  ${INSTALL_HINT(
            command.env.HYPERFRAMES_PLUGIN_VERSION,
          )}`,
        );
      }
      const warning = versionWarning(probe.stdout.trim(), command.env.HYPERFRAMES_PLUGIN_VERSION);
      if (warning) console.error(warning);
    }
    const result = spawnSync(command.command, command.args, {
      env: command.env,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
