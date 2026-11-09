"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

/**
 * The runtime an agent was on before this device moved it anywhere.
 *
 * An agent has one runtime, so restoring "the owner's machine" needs to know
 * which runtime that was — the server keeps no history, and re-deriving it from
 * the owner's runtime list is wrong whenever they have more than one agent CLI
 * installed on the same machine (picking by activity lands on a different CLI
 * than the one that was there). This remembers the exact binding this device
 * replaced, per agent.
 *
 * It is a hint, not authority: the caller only uses an entry while the runtime
 * still exists and is still one this person may bind. A stale entry therefore
 * degrades instead of moving an agent onto a machine that no longer applies.
 *
 * Writing is deliberately narrower than reading: an entry is only recorded
 * while no override is in progress. Switching from one local CLI to another is
 * the same override continuing, and the stored value is still the owner's —
 * recording the CLI being left made the Runtime row follow this one.
 */
export interface AgentOwnerRuntimeState {
  /** agentId -> runtimeId that was bound before this device overrode it. */
  entries: Record<string, string>;
  remember: (agentId: string, runtimeId: string) => void;
  forget: (agentId: string) => void;
}

// StorageAdapter (sync getItem returning string | null) is a structural subset
// of zustand's StateStorage, so it can be handed in directly via cast.
const stateStorage = defaultStorage as unknown as StateStorage;

export const useAgentOwnerRuntimeStore = create<AgentOwnerRuntimeState>()(
  persist(
    (set) => ({
      entries: {},
      remember: (agentId, runtimeId) =>
        set((state) => {
          if (state.entries[agentId] === runtimeId) return state;
          return { entries: { ...state.entries, [agentId]: runtimeId } };
        }),
      forget: (agentId) =>
        set((state) => {
          if (!(agentId in state.entries)) return state;
          const next = { ...state.entries };
          delete next[agentId];
          return { entries: next };
        }),
    }),
    {
      name: "multica_agent_owner_runtime",
      storage: createJSONStorage(() => stateStorage),
    },
  ),
);

export function getRememberedOwnerRuntime(agentId: string): string | null {
  return useAgentOwnerRuntimeStore.getState().entries[agentId] ?? null;
}
