"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";
import type { LocalAgentBinding } from "./types";

/**
 * Which agent CLI each agent runs here, on this device.
 *
 * A preference, not a configuration: it never writes to the agent, so the
 * owner's runtime stays exactly as they left it and two people can run the
 * same agent at the same time.
 */
export interface LocalRunsState {
  bindings: Record<string, LocalAgentBinding>;
  bindAgent: (agentId: string, binding: LocalAgentBinding) => void;
  unbindAgent: (agentId: string) => void;
}

export const useLocalRunsStore = create<LocalRunsState>()(
  persist(
    (set) => ({
      bindings: {},
      bindAgent: (agentId, binding) =>
        set((state) => ({ bindings: { ...state.bindings, [agentId]: binding } })),
      unbindAgent: (agentId) =>
        set((state) => {
          const { [agentId]: _removed, ...rest } = state.bindings;
          return { bindings: rest };
        }),
    }),
    { name: "multica_local_agent_bindings", version: 1, storage: createJSONStorage(() => defaultStorage) },
  ),
);
