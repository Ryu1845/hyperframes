import type { ModelContextTool } from "./types";

/**
 * The Studio tools as built for the open editor, for in-page callers such as the agent panel. WebMCP registration
 * is a separate, opt-in consumer of the same list (`useStudioAgentTools`).
 */

let published: readonly ModelContextTool[] = [];

/** Returns the unpublish for this list; a newer list published meanwhile is left alone. */
export function publishStudioTools(tools: readonly ModelContextTool[]): () => void {
  published = tools;
  return () => {
    if (published === tools) published = [];
  };
}

/** Read at call time, so a run always uses the editor that is open now. */
export function currentStudioTools(): readonly ModelContextTool[] {
  return published;
}
