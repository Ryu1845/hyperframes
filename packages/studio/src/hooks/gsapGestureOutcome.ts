import type {
  CommitMutation,
  CommitMutationOptions,
  MutationResult,
} from "./gsapScriptCommitTypes";
import { adoptingStudioPendingEdit } from "../utils/studioPendingEdits";

/** What a canvas geometry commit reports: whether anything was written. */
export interface GeometryCommitResult {
  ok: true;
  changed: boolean;
}

export function observeGsapGesture(writer: CommitMutation | null) {
  const edit = adoptingStudioPendingEdit();
  const join = <T>(run: () => T): T => (edit ? edit.within(run) : run());
  let changed = false;
  let pendingResults = 0;
  const observe = (options: CommitMutationOptions): CommitMutationOptions => {
    pendingResults += 1;
    return {
      ...options,
      ...(edit && { pendingEdit: edit }),
      onResult: (result: MutationResult) => {
        pendingResults -= 1;
        options.onResult?.(result);
        if (!result.ok || result.changed !== true) return;
        changed = true;
        edit?.markSaved();
      },
    };
  };
  let commit: CommitMutation | null = null;
  if (writer) {
    commit = (selection, mutation, options) =>
      join(() => writer(selection, mutation, observe(options)));
    if (writer.batch) {
      const batch = writer.batch;
      commit.batch = (calls, options) => join(() => batch(calls, observe(options)));
    }
  }
  return {
    commit,
    drawKeepingUndone: <T>(draw: () => T): T => (edit ? edit.drawKeepingUndone(draw) : draw()),
    recordDomResult: (result: { changed: boolean } | undefined) => {
      changed ||= result?.changed === true;
      if (result?.changed) edit?.markSaved();
    },
    finish: (domChanged = false): GeometryCommitResult => {
      if (pendingResults !== 0) return { ok: true, changed: false };
      return { ok: true, changed: changed || domChanged };
    },
  };
}
