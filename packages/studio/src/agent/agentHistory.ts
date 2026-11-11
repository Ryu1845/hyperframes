import { studioApiFetch } from "../utils/studioApiFetch";

/**
 * Per-run undo over the project's history: a run records the history point before it starts and the newest entry
 * when it ends, and its Undo restores the files to the point before. The run's writes go into one history entry
 * labelled with the request, under the agent's name.
 */

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const AGENT = { kind: "agent", name: "Studio agent" } as const;
const START = "start";
// A window that never gets its close ends itself after this long without a write.
const WINDOW_IDLE_MS = 10 * 60_000;

export interface RunMarks {
  before: string;
  windowId: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function historyApi(projectId: string, fetchImpl: Fetch) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/history`;
  const post = (path: string, body: unknown = {}) =>
    fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const newest = async (): Promise<string | null> => {
    const checkpoint = await post("/checkpoint");
    if (!checkpoint.ok) return null;
    const response = await fetchImpl(base);
    if (!response.ok) return null;
    const data: unknown = await response.json().catch(() => null);
    const entries = isRecord(data) && Array.isArray(data.entries) ? data.entries : [];
    const last = entries.at(-1);
    return isRecord(last) && typeof last.id === "string" ? last.id : START;
  };
  return { post, newest };
}

/** Null when this project keeps no history here; the run then has no Undo. */
export async function beginRun(
  projectId: string,
  label: string,
  fetchImpl: Fetch = studioApiFetch,
): Promise<RunMarks | null> {
  const api = historyApi(projectId, fetchImpl);
  const before = await api.newest().catch(() => null);
  if (!before) return null;
  const opened = await api
    .post("/window", { who: AGENT, label: label.slice(0, 80), idleMs: WINDOW_IDLE_MS })
    .catch(() => null);
  const data: unknown = opened?.ok ? await opened.json().catch(() => null) : null;
  return {
    before,
    windowId: isRecord(data) && typeof data.windowId === "string" ? data.windowId : null,
  };
}

/** The newest entry once the run's writes are in, for telling later edits apart at Undo time. */
export async function endRun(
  projectId: string,
  marks: RunMarks,
  fetchImpl: Fetch = studioApiFetch,
): Promise<string | null> {
  const api = historyApi(projectId, fetchImpl);
  if (marks.windowId) {
    await api.post(`/window/${encodeURIComponent(marks.windowId)}/close`).catch(() => null);
  }
  return api.newest().catch(() => null);
}

export type UndoOutcome =
  | { ok: true }
  | { ok: false; laterEdits: true }
  | { ok: false; error: string };

/** Without `force`, refuses when something was recorded after the run, since restoring would undo that too. */
export async function undoRun(
  projectId: string,
  marks: { before: string; after: string | null },
  options: { force?: boolean; fetchImpl?: Fetch } = {},
): Promise<UndoOutcome> {
  const api = historyApi(projectId, options.fetchImpl ?? studioApiFetch);
  const newest = await api.newest();
  if (!options.force && marks.after !== null && newest !== marks.after) {
    return { ok: false, laterEdits: true };
  }
  const response = await api.post("/restore", { point: marks.before });
  if (response.ok) return { ok: true };
  const data: unknown = await response.json().catch(() => null);
  return {
    ok: false,
    error: isRecord(data) && typeof data.error === "string" ? data.error : "Undo failed.",
  };
}
