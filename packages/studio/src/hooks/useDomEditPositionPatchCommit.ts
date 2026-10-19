import { useCallback } from "react";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { PatchOperation } from "../utils/sourcePatcher";
import { DomEditSaveQueueOpenError } from "../utils/domEditSaveQueue";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { wasAlreadyToasted } from "./domEditPersistFailure";

interface UseDomEditPositionPatchCommitParams {
  persistDomEditOperations: PersistDomEditOperations;
  showToast: (message: string, tone?: "error" | "info") => void;
}

type PositionPatchOptions = {
  label: string;
  coalesceKey: string;
  coalesceMs?: number;
  skipRefresh?: boolean;
  deferRender?: boolean;
};

export function useDomEditPositionPatchCommit({
  persistDomEditOperations,
  showToast,
}: UseDomEditPositionPatchCommitParams) {
  return useCallback(
    (selection: DomEditSelection, patches: PatchOperation[], options: PositionPatchOptions) => {
      return persistDomEditOperations(selection, patches, {
        label: options.label,
        coalesceKey: options.coalesceKey,
        coalesceMs: options.coalesceMs,
        skipRefresh: options.skipRefresh ?? true,
        deferRender: options.deferRender,
      }).catch((error) => {
        // The paused-save banner already explains this refusal. Rethrow so the
        // caller reverts the preview instead of treating an unsaved edit as committed.
        if (error instanceof DomEditSaveQueueOpenError) throw error;
        if (!wasAlreadyToasted(error)) {
          showToast(error instanceof Error ? error.message : "Failed to save position");
        }
        throw error;
      });
    },
    [persistDomEditOperations, showToast],
  );
}
