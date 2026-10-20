import { useCallback } from "react";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import type {
  CommitMutation,
  CommitMutationOptions,
  GsapSaveFailureHandler,
} from "./gsapScriptCommitTypes";

export function useSafeGsapCommitMutation(
  commitMutation: CommitMutation,
  onSaveFailure: GsapSaveFailureHandler,
) {
  return useCallback(
    (
      selection: DomEditSelection,
      mutation: Record<string, unknown>,
      options: CommitMutationOptions,
    ): Promise<void> =>
      // Return the chain so awaiting consumers (gesture commit, enable-keyframes)
      // run their post-actions AFTER the server save settles, not immediately.
      // The `.catch` hands the failure to `onSaveFailure` (which toasts) and
      // resolves the chain, so awaiters see a settled (success-after-handled)
      // promise rather than an unhandled rejection.
      commitMutation(selection, mutation, options).catch((error) => {
        onSaveFailure(error);
      }),
    [commitMutation, onSaveFailure],
  );
}
