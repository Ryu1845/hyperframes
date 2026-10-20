import { create } from "zustand";

/** The Agent panel's draft, kept outside the panel so the Ask-agent dialog can hand text to it. */
interface AgentComposerState {
  draft: string;
  setDraft: (draft: string) => void;
}

export const useAgentComposerStore = create<AgentComposerState>((set) => ({
  draft: "",
  setDraft: (draft) => set({ draft }),
}));
