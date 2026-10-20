import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fetchMedia } from "../../../scripts/lib/media-fetch.mjs";

// Download a (presigned) URL to destPath; returns byte length.
export async function downloadTo(url, destPath) {
  const res = await fetchMedia(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}: ${String(url).slice(0, 80)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, bytes);
  return bytes.length;
}
