import { useCallback } from "react";
import { isGsapEditBlockedError } from "./gsapEditOutcome";
import { wasAlreadyToasted } from "./domEditPersistFailure";

function failureToast(error: unknown, toast: boolean): string | null {
  if (!toast || wasAlreadyToasted(error)) return null;
  return isGsapEditBlockedError(error) ? error.message : "Failed to save animated edit.";
}

/** Toast a failed GSAP canvas edit, unless an earlier layer already said so. */
export function useGsapInteractionFailureToast(
  showToast: (message: string, tone?: "error" | "info") => void,
) {
  return useCallback(
    (error: unknown, toast?: boolean) => {
      const message = failureToast(error, toast !== false);
      if (message) showToast(message, "error");
    },
    [showToast],
  );
}
