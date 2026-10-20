// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAgentComposerStore } from "../../agent/agentComposerStore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({ projectId: "demo" }),
}));

const { AgentPanel } = await import("./AgentPanel");

interface Server {
  configured: boolean;
  entries: string[];
  chat: (init?: RequestInit) => Response;
  calls: Array<{ url: string; body: unknown }>;
}

let server: Server;
let mounted: { root: Root; host: HTMLElement } | null = null;

const sse = (...texts: string[]) =>
  new Response(
    [
      ...texts.map(
        (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
      ),
      "data: [DONE]\n\n",
    ].join(""),
  );

function routes(url: string, init?: RequestInit): Response {
  server.calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const history = "/api/projects/demo/history";
  if (url === "/api/agent/status") {
    return Response.json({
      configured: server.configured,
      defaultModel: "anthropic/claude-sonnet-5.5",
    });
  }
  if (url === "/api/agent/chat") return server.chat(init);
  if (url === history) return Response.json({ entries: server.entries.map((id) => ({ id })) });
  if (url === `${history}/window`) return Response.json({ windowId: "w1" });
  return Response.json({ ok: true });
}

beforeEach(() => {
  server = { configured: true, entries: [], chat: () => sse("Done."), calls: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => routes(input, init)),
  );
  useAgentComposerStore.getState().setDraft("");
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  await act(async () => root.render(<AgentPanel />));
  await act(async () => {});
  return host;
}

const button = (host: HTMLElement, label: string) => {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (!found) throw new Error(`no ${label} button`);
  return found;
};

async function settle() {
  for (let i = 0; i < 10; i += 1) await act(async () => {});
}

it("explains how to set the key when none is configured", async () => {
  server.configured = false;
  const host = await mount();
  expect(host.textContent).toContain("OPENROUTER_API_KEY");
  act(() => useAgentComposerStore.getState().setDraft("make it red"));
  expect(button(host, "Send").disabled).toBe(true);
});

it("sends a request, shows the reply, and undoes the run back to where it started", async () => {
  const host = await mount();
  act(() => useAgentComposerStore.getState().setDraft("make the title red"));
  server.chat = () => {
    server.entries = ["agent-run"];
    return sse("Made it ", "red.");
  };
  await act(async () => button(host, "Send").click());
  await settle();

  expect(host.textContent).toContain("make the title red");
  expect(host.textContent).toContain("Made it red.");
  const chat = server.calls.find((call) => call.url === "/api/agent/chat")?.body;
  expect(chat).toMatchObject({
    model: "anthropic/claude-sonnet-5.5",
    messages: [{ role: "user", content: "make the title red" }],
  });
  expect(useAgentComposerStore.getState().draft).toBe("");

  await act(async () => button(host, "Undo").click());
  await settle();
  expect(server.calls.at(-1)).toEqual({
    url: "/api/projects/demo/history/restore",
    body: { point: "start" },
  });
  expect(host.textContent).toContain("Undone");
});

it("stops a run in progress", async () => {
  const host = await mount();
  server.chat = (init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("aborted", "AbortError")),
          );
        },
      }),
    );
  act(() => useAgentComposerStore.getState().setDraft("slow request"));
  await act(async () => button(host, "Send").click());
  await settle();
  expect(host.textContent).toContain("Working…");

  await act(async () => button(host, "Stop").click());
  await settle();
  expect(host.textContent).toContain("Stopped");
  expect(button(host, "Send")).toBeTruthy();
});
