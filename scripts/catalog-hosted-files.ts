import { existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isContainedIn } from "./registry-target-paths.mjs";

// A hosted registry asset is served raw from this repository. Keep every redirect on the same
// HTTPS origin and inside this repository's tree; a contributor manifest must not select a
// runner-local service or another repository's files. The URL parser has already resolved any
// dot segment, so the prefix check sees the path that is actually requested.
const ASSET_ORIGIN = "https://raw.githubusercontent.com";
const ASSET_PATH_PREFIX = "/ryu1845/hyperframes/";
// Match the media-freeze ceiling to allow future video assets while bounding runner memory.
const MAX_ASSET_BYTES = 256 * 1024 * 1024;

function assertRegistryUrl(url: URL): void {
  if (
    url.origin !== ASSET_ORIGIN ||
    !url.pathname.startsWith(ASSET_PATH_PREFIX) ||
    url.username ||
    url.password
  ) {
    throw new Error("Hosted asset URL must point into the registry repository over HTTPS");
  }
}

async function readHostedBody(response: Response): Promise<Uint8Array> {
  await validateResponse(response);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_ASSET_BYTES) throw new Error("Hosted asset exceeds 256 MiB");
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks, bytes);
}

async function validateResponse(response: Response): Promise<void> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Hosted asset fetch failed: HTTP ${response.status}`);
  }
  if (Number(response.headers.get("content-length")) > MAX_ASSET_BYTES) {
    await response.body?.cancel();
    throw new Error("Hosted asset exceeds 256 MiB");
  }
}

async function redirectTarget(response: Response, current: URL): Promise<URL> {
  await response.body?.cancel();
  const location = response.headers.get("location");
  if (!location) throw new Error("Hosted asset redirect has no Location");
  return new URL(location, current);
}

async function fetchHostedAsset(url: string): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(120_000);
  let current = new URL(url);
  for (let hop = 0; hop <= 5; hop++) {
    assertRegistryUrl(current);
    const response = await fetch(current.href, { redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      current = await redirectTarget(response, current);
    } else {
      return readHostedBody(response);
    }
  }
  throw new Error("Hosted asset exceeded redirect limit");
}

interface HostedFile {
  path: string;
  url: string;
}

function hasHostedFields(file: { path?: string; url?: string }): file is HostedFile {
  return typeof file.path === "string" && typeof file.url === "string";
}

function hostedFilesOf(root: string): HostedFile[] {
  const manifestPath = join(root, "registry-item.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    files?: { path?: string; url?: string }[];
  };
  return (manifest.files ?? [])
    .filter(hasHostedFields)
    .filter((file) => file.url.startsWith("https://") && isContainedIn(root, file.path));
}

/** Materialize manifest-hosted bytes only inside the copied preview project. */
export async function fetchHostedFiles(projectDir: string): Promise<void> {
  const root = realpathSync(projectDir);
  for (const file of hostedFilesOf(root)) {
    const bytes = await fetchHostedAsset(file.url);
    const destination = resolve(root, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
}
