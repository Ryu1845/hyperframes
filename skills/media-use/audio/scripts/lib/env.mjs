// Loads provider keys (ELEVENLABS_API_KEY, GEMINI_API_KEY, …) from a project's
// .env for the audio engine. Pure node, vendored so the skill ships standalone.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// A missing `.env`, or a `.env` folder (some home dirs have one), is no env file: null. Read without checking first,
// so the file cannot change between a check and the read.
function envFileText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) return null;
    throw error;
  }
}

// Walk up ≤5 dirs from startDir; load the first .env (shell env always wins).
export function loadEnvFromDir(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 5; i++) {
    const text = envFileText(join(dir, ".env"));
    if (text != null) {
      for (const raw of text.split("\n")) {
        let line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        if (line.startsWith("export ")) line = line.slice(7).trim();
        const eq = line.indexOf("=");
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        if (val.startsWith('"') || val.startsWith("'")) {
          const q = val[0];
          const end = val.indexOf(q, 1);
          val = end > 0 ? val.slice(1, end) : val.slice(1);
        }
        if (!(key in process.env)) process.env[key] = val;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
