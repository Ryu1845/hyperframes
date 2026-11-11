import { describe, expect, it, vi } from "vitest";
import {
  AgentStepLimitError,
  answerOpenToolCalls,
  readTurn,
  runAgent,
  withRecentImagesOnly,
  type AgentEvent,
  type ChatMessage,
} from "./agentLoop";
import type { AgentTool } from "./agentTools";

const sse = (...chunks: unknown[]) =>
  new Response(
    [...chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`), "data: [DONE]\n\n"].join(""),
    { headers: { "content-type": "text/event-stream" } },
  );

const text = (content: string) => ({ choices: [{ delta: { content } }] });
const toolCall = (index: number, id: string, name: string, args: string) => ({
  choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: args } }] } }],
});

function tool(name: string, execute: AgentTool["execute"]): AgentTool {
  return { name, description: name, parameters: { type: "object" }, execute };
}

type FetchArgs = [input: string, init?: RequestInit];

describe("readTurn", () => {
  it("joins streamed text and tool-call fragments, skipping comments", async () => {
    const body = [
      ": OPENROUTER PROCESSING\n\n",
      `data: ${JSON.stringify(text("Hel"))}\n\n`,
      `data: ${JSON.stringify(text("lo"))}\n\n`,
      `data: ${JSON.stringify(toolCall(0, "c1", "hf_read", '{"pa'))}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] } }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    const events: AgentEvent[] = [];
    const turn = await readTurn(new Response(body), (event) => events.push(event));
    expect(turn.content).toBe("Hello");
    expect(turn.toolCalls).toEqual([
      { id: "c1", type: "function", function: { name: "hf_read", arguments: '{"path":"a"}' } },
    ]);
    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    ]);
  });

  it("raises a mid-stream error", async () => {
    await expect(readTurn(sse({ error: { message: "rate limited" } }), () => {})).rejects.toThrow(
      "rate limited",
    );
  });
});

describe("runAgent", () => {
  it("runs the requested tools, returns their results, and stops at the answer", async () => {
    const read = vi.fn(async (input: Record<string, unknown>) => ({
      ok: true,
      content: input.path,
    }));
    const fetchImpl = vi
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValueOnce(sse(toolCall(0, "c1", "hf_read_file", '{"path":"index.html"}')))
      .mockResolvedValueOnce(sse(text("Done.")));
    const messages: ChatMessage[] = [{ role: "user", content: "read it" }];
    const events: AgentEvent[] = [];

    await runAgent({
      messages,
      model: "m",
      tools: [tool("hf_read_file", read)],
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      fetchImpl,
    });

    expect(read).toHaveBeenCalledWith({ path: "index.html" }, expect.any(AbortSignal));
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(messages[2]).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: '{"ok":true,"content":"index.html"}',
    });
    expect(messages[3]).toEqual({ role: "assistant", content: "Done." });
    const second = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(second.model).toBe("m");
    expect(second.tools[0].function.name).toBe("hf_read_file");
    expect(events.filter((event) => event.type !== "text")).toEqual([
      { type: "tool-start", id: "c1", name: "hf_read_file", args: '{"path":"index.html"}' },
      { type: "tool-end", id: "c1", name: "hf_read_file", ok: true, summary: "" },
    ]);
  });

  it("answers bad calls with a failure instead of throwing", async () => {
    const fetchImpl = vi
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValueOnce(
        sse(toolCall(0, "c1", "nope", "{}"), toolCall(1, "c2", "hf_lint", "{not json")),
      )
      .mockResolvedValueOnce(sse(text("ok")));
    const messages: ChatMessage[] = [{ role: "user", content: "x" }];
    await runAgent({
      messages,
      model: "m",
      tools: [tool("hf_lint", async () => ({ ok: true }))],
      signal: new AbortController().signal,
      onEvent: () => {},
      fetchImpl,
    });
    const results = messages.flatMap((message) =>
      message.role === "tool" ? [JSON.parse(message.content)] : [],
    );
    expect(results).toEqual([
      { ok: false, kind: "invalid", reason: "There is no tool named nope." },
      { ok: false, kind: "invalid", reason: "The tool arguments were not valid JSON." },
    ]);
  });

  it("shows the model the frame it captured", async () => {
    const png = new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "content-type": "image/png" },
    });
    const fetchImpl = vi
      .fn<(...args: FetchArgs) => Promise<Response>>()
      .mockResolvedValueOnce(sse(toolCall(0, "c1", "studio_frame", "{}")))
      .mockResolvedValueOnce(png)
      .mockResolvedValueOnce(sse(text("Looks right.")));
    const messages: ChatMessage[] = [{ role: "user", content: "check" }];
    await runAgent({
      messages,
      model: "m",
      tools: [tool("studio_frame", async () => ({ ok: true, url: "/api/frame.png" }))],
      signal: new AbortController().signal,
      onEvent: () => {},
      fetchImpl,
    });
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("/api/frame.png");
    const shown = messages[3];
    expect(shown?.role).toBe("user");
    expect(JSON.stringify(shown)).toContain("data:image/png;base64,iVBORw");
  });

  it("stops after the step limit", async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) => sse(toolCall(0, "c", "hf_lint", "{}")));
    await expect(
      runAgent({
        messages: [{ role: "user", content: "loop" }],
        model: "m",
        tools: [tool("hf_lint", async () => ({ ok: true }))],
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
        maxSteps: 3,
      }),
    ).rejects.toBeInstanceOf(AgentStepLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reports the server's refusal", async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) =>
      Response.json({ error: "OPENROUTER_API_KEY is not set." }, { status: 503 }),
    );
    await expect(
      runAgent({
        messages: [{ role: "user", content: "x" }],
        model: "m",
        tools: [],
        signal: new AbortController().signal,
        onEvent: () => {},
        fetchImpl,
      }),
    ).rejects.toThrow("OPENROUTER_API_KEY is not set.");
  });
});

describe("withRecentImagesOnly", () => {
  it("keeps the images of the last two image turns only", () => {
    const image = (n: number): ChatMessage => ({
      role: "user",
      content: [{ type: "image_url", image_url: { url: `data:${n}` } }],
    });
    const pruned = withRecentImagesOnly([
      image(1),
      image(2),
      { role: "user", content: "hi" },
      image(3),
    ]);
    expect(JSON.stringify(pruned[0])).toContain("[earlier frame omitted]");
    expect(JSON.stringify(pruned[1])).toContain("data:2");
    expect(JSON.stringify(pruned[3])).toContain("data:3");
  });
});

describe("answerOpenToolCalls", () => {
  it("answers each call a stopped run left without a result, once", () => {
    const call = (id: string) => ({
      id,
      type: "function" as const,
      function: { name: "hf_lint", arguments: "{}" },
    });
    const messages: ChatMessage[] = [
      { role: "assistant", content: null, tool_calls: [call("a"), call("b")] },
      { role: "tool", tool_call_id: "a", content: "{}" },
    ];
    answerOpenToolCalls(messages);
    answerOpenToolCalls(messages);
    expect(messages.slice(2)).toEqual([
      {
        role: "tool",
        tool_call_id: "b",
        content: '{"ok":false,"kind":"blocked","reason":"Stopped by the person."}',
      },
    ]);
  });
});
