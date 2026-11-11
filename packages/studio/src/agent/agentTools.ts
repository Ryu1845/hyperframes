import { studioApiFetch } from "../utils/studioApiFetch";
import type { ModelContextTool } from "../webmcp/types";

/**
 * The tools the Studio agent may call: the editor's own element tools, plus project file and lint tools over the
 * same studio-server routes the editor uses. Every tool resolves with `{ ok: true, ... }` or
 * `{ ok: false, kind, reason, hint? }`, the contract the element tools already follow (`webmcp/toolResult.ts`).
 */

export interface AgentTool {
  name: string;
  description: string;
  parameters: object;
  execute: (input: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

export interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: object };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const MAX_LISTED_FILES = 500;
const MAX_READ_CHARS = 200_000;
const MAX_FINDINGS = 100;
const EMPTY_SCHEMA = { type: "object", properties: {} };

export function toOpenAiTools(tools: readonly AgentTool[]): OpenAiTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

export function fromStudioTools(tools: readonly ModelContextTool[]): AgentTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema ?? EMPTY_SCHEMA,
    execute: (input, signal) => tool.execute(input, { signal }),
  }));
}

const failure = (kind: "invalid" | "failed", reason: string, hint?: string) =>
  hint ? { ok: false, kind, reason, hint } : { ok: false, kind, reason };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json().catch(() => null);
  return isRecord(data) ? data : {};
}

function projectPath(input: Record<string, unknown>): string | null {
  const path = input.path;
  if (typeof path !== "string") return null;
  const trimmed = path.trim().replace(/^\.?\/+/, "");
  return trimmed && !trimmed.split("/").includes("..") ? trimmed : null;
}

// A version mismatch, a create over an existing file, and a write that named no version.
const CONFLICT_STATUSES = new Set([409, 412, 428]);

async function versionOf(response: Response): Promise<string | null> {
  const data = await readJson(response);
  return typeof data.version === "string" ? data.version : response.headers.get("etag");
}

const BAD_PATH = failure(
  "invalid",
  "path must be a project-relative file path.",
  "Use a path from hf_list_files, such as index.html.",
);

export function projectFileTools(
  projectId: string,
  fetchImpl: Fetch = studioApiFetch,
): AgentTool[] {
  const project = `/api/projects/${encodeURIComponent(projectId)}`;
  const fileUrl = (path: string) => `${project}/files/${encodeURIComponent(path)}`;

  async function writeFile(input: Record<string, unknown>, signal: AbortSignal) {
    const path = projectPath(input);
    if (!path) return BAD_PATH;
    if (typeof input.content !== "string") return failure("invalid", "content must be a string.");
    const base = typeof input.base_version === "string" ? input.base_version : null;
    const response = await fetchImpl(fileUrl(path), {
      method: "PUT",
      headers: {
        "Content-Type": "text/plain",
        ...(base ? { "If-Match": base } : { "If-None-Match": "*" }),
      },
      body: input.content,
      signal,
    });
    if (CONFLICT_STATUSES.has(response.status)) {
      return failure(
        "failed",
        base ? `${path} changed since you read it.` : `${path} already exists.`,
        "Call hf_read_file, then write again with its version as base_version.",
      );
    }
    if (!response.ok) return failure("failed", `Writing ${path} failed (${response.status}).`);
    return { ok: true, path, version: await versionOf(response) };
  }

  return [
    {
      name: "hf_list_files",
      description:
        "List the project's files and which of them are compositions. Returns ok, files and compositions.",
      parameters: EMPTY_SCHEMA,
      execute: async (_input, signal) => {
        const response = await fetchImpl(project, { signal });
        if (!response.ok) return failure("failed", `Listing files failed (${response.status}).`);
        const data = await readJson(response);
        const files = Array.isArray(data.files)
          ? data.files.filter((f) => typeof f === "string")
          : [];
        return {
          ok: true,
          files: files.slice(0, MAX_LISTED_FILES),
          truncated: files.length > MAX_LISTED_FILES,
          compositions: Array.isArray(data.compositions) ? data.compositions : [],
        };
      },
    },
    {
      name: "hf_read_file",
      description:
        "Read a project file. Returns ok, content and version; pass version as base_version to hf_write_file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path, e.g. index.html" },
        },
        required: ["path"],
      },
      execute: async (input, signal) => {
        const path = projectPath(input);
        if (!path) return BAD_PATH;
        const response = await fetchImpl(fileUrl(path), { signal });
        if (response.status === 404) return failure("invalid", `${path} does not exist.`);
        if (!response.ok) return failure("failed", `Reading ${path} failed (${response.status}).`);
        const data = await readJson(response);
        const content = typeof data.content === "string" ? data.content : "";
        return {
          ok: true,
          path,
          version: typeof data.version === "string" ? data.version : response.headers.get("etag"),
          content: content.slice(0, MAX_READ_CHARS),
          truncated: content.length > MAX_READ_CHARS,
        };
      },
    },
    {
      name: "hf_write_file",
      description: [
        "Write a whole project file. To change an existing file, pass the version hf_read_file returned as",
        "base_version; omit it only to create a new file. A file that changed since you read it is refused:",
        "read it again and redo your edit on the new content. Returns ok and the new version.",
      ].join(" "),
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project-relative path" },
          content: { type: "string", description: "The complete new file content" },
          base_version: { type: "string", description: "The version you read; omit to create" },
        },
        required: ["path", "content"],
      },
      execute: (input, signal) => writeFile(input, signal),
    },
    {
      name: "hf_lint",
      description:
        "Lint every composition in the project. Returns ok and findings; fix every finding with severity error.",
      parameters: EMPTY_SCHEMA,
      execute: async (_input, signal) => {
        const response = await fetchImpl(`${project}/lint`, { signal });
        const data = await readJson(response);
        if (!response.ok) {
          return failure("failed", typeof data.error === "string" ? data.error : "Lint failed.");
        }
        const findings = Array.isArray(data.findings) ? data.findings : [];
        return {
          ok: true,
          findings: findings.slice(0, MAX_FINDINGS),
          truncated: findings.length > MAX_FINDINGS,
        };
      },
    },
  ];
}
