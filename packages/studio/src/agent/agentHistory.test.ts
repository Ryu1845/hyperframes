import { describe, expect, it, vi } from "vitest";
import { beginRun, endRun, undoRun } from "./agentHistory";

type FetchArgs = [input: string, init?: RequestInit];

/** A history route stub: `entries` is what GET /history lists, oldest first. */
function historyServer(entries: string[]) {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const path = input.replace("/api/projects/p/history", "");
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "") return Response.json({ entries: entries.map((id) => ({ id })) });
    if (path === "/window") return Response.json({ windowId: "w1" });
    return Response.json({ ok: true });
  });
  return { fetchImpl, calls };
}

describe("agent run history", () => {
  it("marks the point before a run and opens one agent window for its writes", async () => {
    const { fetchImpl, calls } = historyServer(["e1", "e2"]);
    const marks = await beginRun("p", "make the title red", fetchImpl);
    expect(marks).toEqual({ before: "e2", windowId: "w1" });
    expect(calls.map((call) => call.path)).toEqual(["/checkpoint", "", "/window"]);
    expect(calls[2]?.body).toMatchObject({
      who: { kind: "agent", name: "Studio agent" },
      label: "make the title red",
    });
  });

  it("starts from the beginning of a project with no entries yet", async () => {
    const { fetchImpl } = historyServer([]);
    expect((await beginRun("p", "x", fetchImpl))?.before).toBe("start");
  });

  it("has no undo where the project keeps no history", async () => {
    const fetchImpl = vi.fn(async (..._args: FetchArgs) =>
      Response.json({ error: "no" }, { status: 404 }),
    );
    expect(await beginRun("p", "x", fetchImpl)).toBeNull();
  });

  it("closes the window and reads the run's last entry", async () => {
    const { fetchImpl, calls } = historyServer(["e2", "agent-run"]);
    expect(await endRun("p", { before: "e2", windowId: "w1" }, fetchImpl)).toBe("agent-run");
    expect(calls[0]?.path).toBe("/window/w1/close");
  });

  it("restores the point before the run, and asks first when later edits would go too", async () => {
    const clean = historyServer(["e2", "agent-run"]);
    expect(
      await undoRun("p", { before: "e2", after: "agent-run" }, { fetchImpl: clean.fetchImpl }),
    ).toEqual({
      ok: true,
    });
    expect(clean.calls.at(-1)).toEqual({ path: "/restore", body: { point: "e2" } });

    const later = historyServer(["e2", "agent-run", "you-later"]);
    expect(
      await undoRun("p", { before: "e2", after: "agent-run" }, { fetchImpl: later.fetchImpl }),
    ).toEqual({
      ok: false,
      laterEdits: true,
    });
    expect(later.calls.some((call) => call.path === "/restore")).toBe(false);
    expect(
      await undoRun(
        "p",
        { before: "e2", after: "agent-run" },
        { force: true, fetchImpl: later.fetchImpl },
      ),
    ).toEqual({ ok: true });
  });
});
