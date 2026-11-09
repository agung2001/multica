"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";
import {
  LOCAL_RUN_LIMIT,
  LOCAL_RUN_OUTPUT_LIMIT,
  type LocalAgentBinding,
  type LocalRun,
  type LocalRunStatus,
} from "./types";

/**
 * The private board: work that runs only on this machine, plus which agent CLI
 * each agent should use here.
 *
 * Persisted on the device and never sent anywhere. Deliberately separate from
 * query state — the server has no idea these exist, and that is the feature.
 */
export interface LocalRunsState {
  runs: LocalRun[];
  bindings: Record<string, LocalAgentBinding>;
  /** Creates an empty draft and returns its id. */
  create: (input?: Partial<Pick<LocalRun, "title" | "agentId" | "agentName" | "command">>) => string;
  update: (id: string, patch: Partial<Omit<LocalRun, "id" | "createdAt">>) => void;
  remove: (id: string) => void;
  setStatus: (id: string, status: LocalRunStatus) => void;
  /** Appends transcript output, keeping only the tail past the cap. */
  appendOutput: (id: string, chunk: string) => void;
  clearOutput: (id: string) => void;
  bindAgent: (agentId: string, binding: LocalAgentBinding) => void;
  unbindAgent: (agentId: string) => void;
}

const stateStorage = defaultStorage as unknown as StateStorage;

let counter = 0;

/**
 * Ids only have to be unique on this device, so a counter plus a timestamp is
 * enough and keeps drafts working offline.
 */
function localId(now: string): string {
  counter += 1;
  return `${now}-${counter}`;
}

function stamp(): string {
  return new Date().toISOString();
}

function withOutputCap(output: string): string {
  if (output.length <= LOCAL_RUN_OUTPUT_LIMIT) return output;
  return `…[earlier output dropped]\n${output.slice(-LOCAL_RUN_OUTPUT_LIMIT)}`;
}

/** Newest first, oldest dropped past the cap. */
function order(runs: LocalRun[]): LocalRun[] {
  return [...runs]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, LOCAL_RUN_LIMIT);
}

export const useLocalRunsStore = create<LocalRunsState>()(
  persist(
    (set) => ({
      runs: [],
      bindings: {},
      create: (input = {}) => {
        const now = stamp();
        const id = localId(now);
        const run: LocalRun = {
          id,
          title: input.title ?? "",
          body: "",
          agentId: input.agentId ?? null,
          agentName: input.agentName ?? "",
          command: input.command ?? "",
          cwd: "",
          status: "draft",
          output: "",
          createdAt: now,
          updatedAt: now,
          publishedIssueId: null,
        };
        set((state) => ({ runs: order([run, ...state.runs]) }));
        return id;
      },
      update: (id, patch) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === id ? { ...run, ...patch, updatedAt: stamp() } : run,
          ),
        })),
      remove: (id) =>
        set((state) => ({ runs: state.runs.filter((run) => run.id !== id) })),
      setStatus: (id, status) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === id ? { ...run, status, updatedAt: stamp() } : run,
          ),
        })),
      appendOutput: (id, chunk) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === id
              ? { ...run, output: withOutputCap(run.output + chunk), updatedAt: stamp() }
              : run,
          ),
        })),
      clearOutput: (id) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === id ? { ...run, output: "", updatedAt: stamp() } : run,
          ),
        })),
      bindAgent: (agentId, binding) =>
        set((state) => ({ bindings: { ...state.bindings, [agentId]: binding } })),
      unbindAgent: (agentId) =>
        set((state) => {
          if (!(agentId in state.bindings)) return state;
          const next = { ...state.bindings };
          delete next[agentId];
          return { bindings: next };
        }),
    }),
    {
      name: "multica_local_runs",
      storage: createJSONStorage(() => stateStorage),
      version: 1,
    },
  ),
);

export function localRunsSnapshot(): LocalRun[] {
  return useLocalRunsStore.getState().runs;
}

export function localBindingFor(agentId: string): LocalAgentBinding | null {
  return useLocalRunsStore.getState().bindings[agentId] ?? null;
}
