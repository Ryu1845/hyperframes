import { studioApiFetch } from "../utils/studioApiFetch";
import { toOpenAiTools, type AgentTool } from "./agentTools";

/**
 * One agent run: send the conversation to the preview server's OpenRouter proxy, run the tool calls the model
 * asks for, and repeat until it answers without one. The server adds the key and the system prompt.
 */

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool-start"; id: string; name: string; args: string }
  | { type: "tool-end"; id: string; name: string; ok: boolean; summary: string };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface RunAgentOptions {
  messages: ChatMessage[];
  model: string;
  tools: readonly AgentTool[];
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  fetchImpl?: Fetch;
  maxSteps?: number;
}

export class AgentStepLimitError extends Error {}

const MAX_AGENT_STEPS = 25;
// Frames are the bulk of a long conversation; the model needs only the latest to judge its work.
const KEPT_IMAGE_TURNS = 2;
const MAX_TOOL_RESULT_CHARS = 50_000;
const FRAME_TOOL = "studio_frame";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasImage = (message: ChatMessage) =>
  message.role === "user" &&
  typeof message.content !== "string" &&
  message.content.some((part) => part.type === "image_url");

const withoutImages = (parts: ContentPart[]): ContentPart[] =>
  parts.map((part) =>
    part.type === "image_url" ? { type: "text", text: "[earlier frame omitted]" } : part,
  );

/** Replaces the images of all but the last `keep` image-bearing turns with a note, so the request stays small. */
export function withRecentImagesOnly(messages: readonly ChatMessage[], keep = KEPT_IMAGE_TURNS) {
  let seen = 0;
  const kept = [...messages].reverse().map((message) => {
    if (message.role !== "user" || typeof message.content === "string" || !hasImage(message)) {
      return message;
    }
    seen += 1;
    return seen <= keep ? message : { ...message, content: withoutImages(message.content) };
  });
  return kept.reverse();
}

interface Turn {
  content: string;
  toolCalls: ToolCall[];
}

/** Tool calls stream in pieces keyed by index: the id and name once, the arguments a fragment at a time. */
function mergeToolCallDelta(raw: unknown, turn: Turn) {
  if (!isRecord(raw)) return;
  const index = typeof raw.index === "number" ? raw.index : turn.toolCalls.length;
  const call = (turn.toolCalls[index] ??= {
    id: "",
    type: "function",
    function: { name: "", arguments: "" },
  });
  if (typeof raw.id === "string") call.id = raw.id;
  const fn = isRecord(raw.function) ? raw.function : {};
  if (typeof fn.name === "string") call.function.name += fn.name;
  if (typeof fn.arguments === "string") call.function.arguments += fn.arguments;
}

/** A stream can end in an error object instead of a choice, e.g. when the provider rate-limits mid-answer. */
function throwIfStreamError(chunk: Record<string, unknown>) {
  if (!isRecord(chunk.error)) return;
  const message = chunk.error.message;
  throw new Error(typeof message === "string" ? message : "The model failed.");
}

function deltaOf(chunk: Record<string, unknown>): Record<string, unknown> {
  const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
  return isRecord(choice) && isRecord(choice.delta) ? choice.delta : {};
}

function applyChunk(chunk: unknown, turn: Turn, onEvent: RunAgentOptions["onEvent"]) {
  if (!isRecord(chunk)) return;
  throwIfStreamError(chunk);
  const delta = deltaOf(chunk);
  if (typeof delta.content === "string" && delta.content) {
    turn.content += delta.content;
    onEvent({ type: "text", delta: delta.content });
  }
  const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
  for (const raw of calls) mergeToolCallDelta(raw, turn);
}

/** The JSON of one `data:` line; null for comments, `[DONE]`, blank lines and anything unparsable. */
function sseData(line: string): unknown {
  const data = line.startsWith("data:") ? line.slice(5).trim() : "";
  if (!data || data === "[DONE]") return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** Reads an OpenAI-style chat completion stream (`data: {...}` lines, `data: [DONE]`, `:` comments). */
export async function readTurn(
  response: Response,
  onEvent: RunAgentOptions["onEvent"],
): Promise<Turn> {
  const turn: Turn = { content: "", toolCalls: [] };
  if (!response.body) return turn;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let done = false;
  while (!done) {
    const read = await reader.read();
    done = read.done;
    buffer += read.value ?? "";
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");
    for (const line of lines) applyChunk(sseData(line), turn, onEvent);
  }
  turn.toolCalls = turn.toolCalls
    .filter(Boolean)
    .map((call, index) => ({ ...call, id: call.id || `call_${index}` }));
  return turn;
}

async function errorOf(response: Response): Promise<string> {
  const data: unknown = await response.json().catch(() => null);
  if (!isRecord(data)) return `The agent request failed (${response.status}).`;
  const detail = typeof data.detail === "string" && data.detail ? ` ${data.detail}` : "";
  return `${typeof data.error === "string" ? data.error : "The agent request failed."}${detail}`;
}

function summarize(result: unknown): { ok: boolean; summary: string } {
  if (!isRecord(result)) return { ok: true, summary: "" };
  if (result.ok === false) {
    return { ok: false, summary: typeof result.reason === "string" ? result.reason : "failed" };
  }
  return { ok: true, summary: "" };
}

async function frameAsDataUrl(url: string, fetchImpl: Fetch, signal: AbortSignal) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const type = response.headers.get("content-type")?.split(";")[0] || "image/png";
  return `data:${type};base64,${btoa(binary)}`;
}

async function runCall(
  call: ToolCall,
  byName: Map<string, AgentTool>,
  signal: AbortSignal,
): Promise<unknown> {
  const tool = byName.get(call.function.name);
  if (!tool) {
    return { ok: false, kind: "invalid", reason: `There is no tool named ${call.function.name}.` };
  }
  let input: unknown;
  try {
    input = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { ok: false, kind: "invalid", reason: "The tool arguments were not valid JSON." };
  }
  if (!isRecord(input)) {
    return { ok: false, kind: "invalid", reason: "The tool arguments must be a JSON object." };
  }
  try {
    return await tool.execute(input, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return {
      ok: false,
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** A run stopped between a tool call and its result leaves the call unanswered, which the next request may not. */
export function answerOpenToolCalls(messages: ChatMessage[], reason = "Stopped by the person.") {
  const answered = new Set(
    messages.flatMap((message) => (message.role === "tool" ? [message.tool_call_id] : [])),
  );
  for (const message of [...messages]) {
    if (message.role !== "assistant" || !message.tool_calls) continue;
    for (const call of message.tool_calls) {
      if (answered.has(call.id)) continue;
      answered.add(call.id);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ ok: false, kind: "blocked", reason }),
      });
    }
  }
}

interface StepContext {
  messages: ChatMessage[];
  byName: Map<string, AgentTool>;
  signal: AbortSignal;
  onEvent: RunAgentOptions["onEvent"];
  fetchImpl: Fetch;
}

async function frameOf(call: ToolCall, result: unknown, context: StepContext) {
  if (call.function.name !== FRAME_TOOL || !isRecord(result) || result.ok !== true) return null;
  if (typeof result.url !== "string") return null;
  return frameAsDataUrl(result.url, context.fetchImpl, context.signal);
}

/** Runs one turn's calls in order and appends their results; returns the frames the model asked to see. */
async function runToolCalls(calls: readonly ToolCall[], context: StepContext): Promise<string[]> {
  const frames: string[] = [];
  for (const call of calls) {
    const { id, function: fn } = call;
    context.onEvent({ type: "tool-start", id, name: fn.name, args: fn.arguments });
    const result = await runCall(call, context.byName, context.signal);
    context.onEvent({ type: "tool-end", id, name: fn.name, ...summarize(result) });
    const content = JSON.stringify(result ?? null).slice(0, MAX_TOOL_RESULT_CHARS);
    context.messages.push({ role: "tool", tool_call_id: id, content });
    const frame = await frameOf(call, result, context);
    if (frame) frames.push(frame);
  }
  return frames;
}

function framesMessage(frames: readonly string[]): ChatMessage {
  return {
    role: "user",
    content: [
      { type: "text", text: "The frame you captured:" },
      ...frames.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ],
  };
}

/** Appends the run's turns to `messages` (in place, so a stopped run keeps what it did) and resolves at the answer. */
export async function runAgent(options: RunAgentOptions): Promise<void> {
  const { messages, model, tools, signal, onEvent } = options;
  const context: StepContext = {
    messages,
    byName: new Map(tools.map((tool) => [tool.name, tool])),
    signal,
    onEvent,
    fetchImpl: options.fetchImpl ?? studioApiFetch,
  };
  const toolDefinitions = toOpenAiTools(tools);
  const maxSteps = options.maxSteps ?? MAX_AGENT_STEPS;

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await context.fetchImpl("/api/agent/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: withRecentImagesOnly(messages),
        tools: toolDefinitions,
      }),
      signal,
    });
    if (!response.ok) throw new Error(await errorOf(response));
    const turn = await readTurn(response, onEvent);
    const calls = turn.toolCalls;
    messages.push({
      role: "assistant",
      content: turn.content || null,
      ...(calls.length ? { tool_calls: calls } : {}),
    });
    if (!calls.length) return;
    const frames = await runToolCalls(calls, context);
    if (frames.length) messages.push(framesMessage(frames));
  }
  throw new AgentStepLimitError(`Stopped after ${maxSteps} tool rounds.`);
}
