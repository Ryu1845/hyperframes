import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectConfig,
  DEFAULT_PROJECT_CONFIG,
  projectConfigPath,
  writeProjectConfig,
} from "./projectConfig.js";

const dirs: string[] = [];
function project() {
  const dir = fs.mkdtempSync(join(tmpdir(), "hf-config-create-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    expect(fs.readdirSync(dir).filter((name) => name.startsWith(".hf-create-"))).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("project config creation", () => {
  it("preserves existing bytes on create and still permits intentional updates", () => {
    const dir = project();
    const path = projectConfigPath(dir);
    createProjectConfig(dir);
    expect(fs.readFileSync(path, "utf-8")).toBe(
      JSON.stringify(DEFAULT_PROJECT_CONFIG, null, 2) + "\n",
    );
    const updated = { ...DEFAULT_PROJECT_CONFIG, registry: "https://custom.example" };
    createProjectConfig(dir, updated);
    expect(JSON.parse(fs.readFileSync(path, "utf-8"))).toEqual(DEFAULT_PROJECT_CONFIG);
    writeProjectConfig(dir, updated);
    expect(JSON.parse(fs.readFileSync(path, "utf-8"))).toEqual(updated);
  });

  it("does not create a dangling symlink target when creating a config", () => {
    const dir = project();
    const target = join(dir, "missing.json");
    fs.symlinkSync(target, projectConfigPath(dir));
    createProjectConfig(dir);
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.lstatSync(projectConfigPath(dir)).isSymbolicLink()).toBe(true);
  });
});
