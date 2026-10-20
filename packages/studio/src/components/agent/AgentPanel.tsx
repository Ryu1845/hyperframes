import { useState, type KeyboardEvent } from "react";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { useMountEffect } from "../../hooks/useMountEffect";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { useAgentComposerStore } from "../../agent/agentComposerStore";
import { useAgentSession, type AgentRow, type AgentRun } from "../../agent/useAgentSession";
import { Button, cn, fieldBase, fieldText } from "../ui";

interface AgentStatus {
  configured: boolean;
  defaultModel: string;
}

type ToolRow = Extract<AgentRow, { kind: "tool" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readStatus(): Promise<AgentStatus | null> {
  const response = await studioApiFetch("/api/agent/status");
  const data: unknown = response.ok ? await response.json() : null;
  if (!isRecord(data) || typeof data.defaultModel !== "string") return null;
  return { configured: data.configured === true, defaultModel: data.defaultModel };
}

async function readModels(): Promise<string[]> {
  const response = await studioApiFetch("/api/agent/models");
  const data: unknown = response.ok ? await response.json() : null;
  const models = isRecord(data) && Array.isArray(data.models) ? data.models : [];
  return models.flatMap((model) =>
    isRecord(model) && typeof model.id === "string" ? [model.id] : [],
  );
}

/** The argument worth showing next to a tool's name: what it read, wrote, selected or sought. */
function toolTarget(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args || "{}");
    if (!isRecord(parsed)) return "";
    const value = [parsed.path, parsed.handle, parsed.time].find(
      (candidate) => typeof candidate === "string" || typeof candidate === "number",
    );
    return value === undefined ? "" : String(value);
  } catch {
    return ""; // Arguments still streaming in, or not JSON: the name alone will do.
  }
}

/** "hf_read_file" with {"path":"index.html"} reads as "read file · index.html". */
function toolLabel(row: ToolRow): string {
  const name = row.name.replace(/^(hf|studio)_/, "").replace(/_/g, " ");
  const target = toolTarget(row.args);
  return target ? `${name} · ${target}` : name;
}

const TOOL_MARKS = { pending: "…", ok: "✓", failed: "✗" } as const;

function ToolRowView({ row }: { row: ToolRow }) {
  const mark = row.ok === undefined ? "pending" : row.ok ? "ok" : "failed";
  return (
    <div
      title={row.summary || row.args}
      className="flex min-w-0 items-center gap-1.5 text-step-12 text-text-4"
    >
      <span aria-hidden="true" className={cn(mark === "failed" && "text-danger-ink")}>
        {TOOL_MARKS[mark]}
      </span>
      <span className="truncate">{toolLabel(row)}</span>
      {mark === "failed" && row.summary && (
        <span className="truncate text-danger-ink">{row.summary}</span>
      )}
    </div>
  );
}

function runStatus(run: AgentRun): string {
  if (run.state === "running") return "Working…";
  if (run.state === "stopped") return "Stopped";
  if (run.state === "failed") return run.error ?? "Failed";
  if (run.undone) return "Undone";
  return run.error ?? "";
}

function RunCard({ run, onUndo }: { run: AgentRun; onUndo: (run: AgentRun) => void }) {
  const canUndo = run.state !== "running" && run.undo !== null && !run.undone;
  return (
    <div className="flex flex-col gap-2 border-b border-border-strong px-3 py-3">
      <p className="self-end max-w-[90%] whitespace-pre-wrap rounded-md bg-bg-2 px-2.5 py-1.5 text-step-11 text-text-1">
        {run.prompt}
      </p>
      {run.rows.map((row, index) =>
        row.kind === "text" ? (
          <p key={index} className="whitespace-pre-wrap text-step-11 text-text-1">
            {row.text}
          </p>
        ) : (
          <ToolRowView key={row.id || index} row={row} />
        ),
      )}
      <div className="flex items-center justify-between gap-2 text-step-12 text-text-4">
        <span className={cn(run.state === "failed" && "text-danger-ink")}>{runStatus(run)}</span>
        {canUndo && (
          <Button variant="ghost" size="sm" onClick={() => onUndo(run)}>
            Undo
          </Button>
        )}
      </div>
    </div>
  );
}

function ModelPicker({
  model,
  placeholder,
  onChange,
}: {
  model: string;
  placeholder: string;
  onChange: (model: string) => void;
}) {
  const [models, setModels] = useState<string[] | null>(null);
  return (
    <label className={cn(fieldBase, "flex-1")}>
      <span className="sr-only">Model</span>
      <input
        className={fieldText}
        list="hf-agent-models"
        placeholder={placeholder}
        value={model}
        onFocus={() => {
          if (models === null) void readModels().then(setModels, () => setModels([]));
        }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => writeStudioUiPreferences({ agentModel: model.trim() || undefined })}
      />
      <datalist id="hf-agent-models">
        {(models ?? []).map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>
    </label>
  );
}

function Composer({
  running,
  canSend,
  onSend,
  onStop,
}: {
  running: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const draft = useAgentComposerStore((state) => state.draft);
  const setDraft = useAgentComposerStore((state) => state.setDraft);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSend();
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border-strong p-3">
      <textarea
        aria-label="Describe a change"
        className={cn(fieldBase, fieldText, "h-20 resize-none py-1.5")}
        placeholder="Describe a change"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex justify-end">
        {running ? (
          <Button variant="secondary" size="sm" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" size="sm" disabled={!canSend} onClick={onSend}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}

function Intro({ status, empty }: { status: AgentStatus | null; empty: boolean }) {
  if (status && !status.configured) {
    return (
      <div className="m-3 rounded-md border border-border-strong bg-bg-2 p-3 text-step-11 text-text-2">
        Set <code>OPENROUTER_API_KEY</code> in your shell or the project's <code>.env</code>, then
        restart <code>hyperframes preview</code>. Runs bill to your OpenRouter account.
      </div>
    );
  }
  if (!status || !empty) return null;
  return (
    <p className="p-3 text-step-11 text-text-4">
      Describe a change. The agent reads and edits this project's files and elements, lints them,
      and looks at the frame it changed. Each run can be undone.
    </p>
  );
}

export function AgentPanel() {
  const { projectId } = useStudioShellContext();
  const session = useAgentSession(projectId);
  const hasDraft = useAgentComposerStore((state) => Boolean(state.draft.trim()));
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [model, setModel] = useState(() => readStudioUiPreferences().agentModel ?? "");

  useMountEffect(() => {
    void readStatus().then(setStatus, () => {});
  });

  const activeModel = model.trim() || status?.defaultModel || "";
  const canSend = Boolean(status?.configured && activeModel && hasDraft && !session.running);

  const send = () => {
    if (!canSend) return;
    const { draft, setDraft } = useAgentComposerStore.getState();
    setDraft("");
    void session.send(draft.trim(), activeModel);
  };

  const undo = (run: AgentRun) =>
    void session.undo(run, () =>
      window.confirm("Edits made after this run will be undone too. Undo anyway?"),
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="agent-panel">
      <div className="flex items-center gap-2 border-b border-border-strong px-3 py-2">
        <ModelPicker
          model={model}
          placeholder={status?.defaultModel ?? "OpenRouter model"}
          onChange={setModel}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={session.running || session.runs.length === 0}
          onClick={session.reset}
        >
          New chat
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Intro status={status} empty={session.runs.length === 0} />
        {session.runs.map((run) => (
          <RunCard key={run.id} run={run} onUndo={undo} />
        ))}
      </div>
      <Composer running={session.running} canSend={canSend} onSend={send} onStop={session.stop} />
    </div>
  );
}
