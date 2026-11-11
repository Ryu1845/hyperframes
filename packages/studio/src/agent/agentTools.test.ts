import { describe, expect, it, vi } from "vitest";
import { fromStudioTools, projectFileTools, toOpenAiTools, type AgentTool } from "./agentTools";
import { buildStudioTools, type StudioAgentToolsDeps } from "../webmcp/useStudioAgentTools";

type FetchArgs = [input: string, init?: RequestInit];
const signal = new AbortController().signal;

function toolsWith(fetchImpl: (...args: FetchArgs) => Promise<Response>) {
  const tools = projectFileTools("my project", fetchImpl);
  return (name: string): AgentTool => {
    const found = tools.find((tool) => tool.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
}

describe("agent tool definitions", () => {
  it("are valid OpenAI function tools, Studio's element tools included", () => {
    const studio = fromStudioTools(buildStudioTools({ current: {} as StudioAgentToolsDeps }));
    const all = toOpenAiTools([...studio, ...projectFileTools("p")]);
    expect(all.length).toBe(studio.length + 4);
    expect(new Set(all.map((tool) => tool.function.name)).size).toBe(all.length);
    for (const { type, function: fn } of all) {
      expect(type).toBe("function");
      expect(fn.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(fn.description.length).toBeGreaterThan(0);
      expect(fn.parameters).toMatchObject({ type: "object" });
    }
  });
});

describe("project file tools", () => {
  it("reads a file with its version", async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) =>
      Response.json({ content: "<html></html>", version: "v1" }),
    );
    const result = await toolsWith(fetchImpl)("hf_read_file").execute(
      { path: "./index.html" },
      signal,
    );
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/projects/my%20project/files/index.html");
    expect(result).toEqual({
      ok: true,
      path: "index.html",
      version: "v1",
      content: "<html></html>",
      truncated: false,
    });
  });

  it("refuses paths that leave the project", async () => {
    const fetchImpl = vi.fn();
    const result = await toolsWith(fetchImpl)("hf_read_file").execute(
      { path: "../secrets" },
      signal,
    );
    expect(result).toMatchObject({ ok: false, kind: "invalid" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("writes against the version it read, and creates only what does not exist", async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) =>
      Response.json({ ok: true, version: "v2" }),
    );
    const write = toolsWith(fetchImpl)("hf_write_file");
    expect(
      await write.execute({ path: "index.html", content: "x", base_version: "v1" }, signal),
    ).toEqual({ ok: true, path: "index.html", version: "v2" });
    expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("if-match")).toBe("v1");
    await write.execute({ path: "new.html", content: "y" }, signal);
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("if-none-match")).toBe("*");
  });

  it("turns a stale write into a re-read instruction", async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) =>
      Response.json({ error: "file conflict", currentVersion: "v9" }, { status: 409 }),
    );
    const result = await toolsWith(fetchImpl)("hf_write_file").execute(
      { path: "index.html", content: "x", base_version: "v1" },
      signal,
    );
    expect(result).toEqual({
      ok: false,
      kind: "failed",
      reason: "index.html changed since you read it.",
      hint: "Call hf_read_file, then write again with its version as base_version.",
    });
  });

  it("lists files and lints", async () => {
    const fetchImpl = vi
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json({ files: ["index.html", 3], compositions: ["index.html"] }),
      )
      .mockResolvedValueOnce(Response.json({ findings: [{ severity: "error", message: "m" }] }));
    const get = toolsWith(fetchImpl);
    expect(await get("hf_list_files").execute({}, signal)).toEqual({
      ok: true,
      files: ["index.html"],
      truncated: false,
      compositions: ["index.html"],
    });
    expect(await get("hf_lint").execute({}, signal)).toEqual({
      ok: true,
      findings: [{ severity: "error", message: "m" }],
      truncated: false,
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("/api/projects/my%20project/lint");
  });
});
