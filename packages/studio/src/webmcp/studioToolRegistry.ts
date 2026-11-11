import type { ModelContextTool } from "./types";

// For in-page callers (the Agent panel), whatever the WebMCP registration preference says.
let published: readonly ModelContextTool[] = [];

export function publishStudioTools(tools: readonly ModelContextTool[]): () => void {
  published = tools;
  return () => {
    if (published === tools) published = [];
  };
}

export function currentStudioTools(): readonly ModelContextTool[] {
  return published;
}
