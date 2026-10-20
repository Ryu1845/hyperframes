import { useCallback, useRef, useState } from "react";
import { currentStudioTools } from "../webmcp/studioToolRegistry";
import { beginRun, endRun, undoRun } from "./agentHistory";
import { answerOpenToolCalls, runAgent, type AgentEvent, type ChatMessage } from "./agentLoop";
import { fromStudioTools, projectFileTools } from "./agentTools";

export type AgentRow =
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; args: string; ok?: boolean; summary?: string };

export interface AgentRun {
  id: number;
  prompt: string;
  rows: AgentRow[];
  state: "running" | "done" | "stopped" | "failed";
  error?: string;
  /** Where Undo restores to, and the run's last history entry; null where the project keeps no history. */
  undo: { before: string; after: string | null } | null;
  undone: boolean;
}

/** Folds one loop event into a run's rows: text deltas join the last text row, tool events open and close rows. */
function applyAgentEvent(rows: readonly AgentRow[], event: AgentEvent): AgentRow[] {
  if (event.type === "text") {
    const last = rows.at(-1);
    if (last?.kind === "text")
      return [...rows.slice(0, -1), { kind: "text", text: last.text + event.delta }];
    return [...rows, { kind: "text", text: event.delta }];
  }
  if (event.type === "tool-start") {
    return [...rows, { kind: "tool", id: event.id, name: event.name, args: event.args }];
  }
  return rows.map((row) =>
    row.kind === "tool" && row.id === event.id
      ? { ...row, ok: event.ok, summary: event.summary }
      : row,
  );
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

export function useAgentSession(projectId: string) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const running = runs.at(-1)?.state === "running";

  const update = useCallback((id: number, change: (run: AgentRun) => AgentRun) => {
    setRuns((all) => all.map((run) => (run.id === id ? change(run) : run)));
  }, []);

  const send = useCallback(
    async (prompt: string, model: string) => {
      if (abortRef.current) return;
      const id = nextId.current++;
      const controller = new AbortController();
      abortRef.current = controller;
      setRuns((all) => [
        ...all,
        { id, prompt, rows: [], state: "running", undo: null, undone: false },
      ]);
      const tools = [...fromStudioTools(currentStudioTools()), ...projectFileTools(projectId)];
      messagesRef.current.push({ role: "user", content: prompt });
      const marks = await beginRun(projectId, prompt).catch(() => null);
      let outcome: Pick<AgentRun, "state" | "error"> = { state: "done" };
      try {
        await runAgent({
          messages: messagesRef.current,
          model,
          tools,
          signal: controller.signal,
          onEvent: (event) =>
            update(id, (run) => ({ ...run, rows: applyAgentEvent(run.rows, event) })),
        });
      } catch (error) {
        outcome = isAbort(error)
          ? { state: "stopped" }
          : { state: "failed", error: error instanceof Error ? error.message : String(error) };
      } finally {
        answerOpenToolCalls(messagesRef.current);
        abortRef.current = null;
        const after = marks ? await endRun(projectId, marks).catch(() => null) : null;
        update(id, (run) => ({
          ...run,
          ...outcome,
          undo: marks && after !== marks.before ? { before: marks.before, after } : null,
        }));
      }
    },
    [projectId, update],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const undo = useCallback(
    async (run: AgentRun, confirmLaterEdits: () => boolean) => {
      if (!run.undo) return;
      let outcome = await undoRun(projectId, run.undo);
      if (!outcome.ok && "laterEdits" in outcome) {
        if (!confirmLaterEdits()) return;
        outcome = await undoRun(projectId, run.undo, { force: true });
      }
      if (outcome.ok) {
        update(run.id, (current) => ({ ...current, undone: true }));
        messagesRef.current.push({
          role: "user",
          content: `(The person undid your changes for: "${run.prompt}". The files are back as they were before it.)`,
        });
      } else if ("error" in outcome) {
        update(run.id, (current) => ({ ...current, error: outcome.error }));
      }
    },
    [projectId, update],
  );

  const reset = useCallback(() => {
    if (abortRef.current) return;
    messagesRef.current = [];
    setRuns([]);
  }, []);

  return { runs, running, send, stop, undo, reset };
}
