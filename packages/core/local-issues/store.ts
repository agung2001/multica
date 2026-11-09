"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Issue, IssuePriority, IssueStatus } from "../types";
import { defaultStorage } from "../platform/storage";

/**
 * An issue that exists only on this device.
 *
 * It is shaped exactly like a server issue so the ordinary board, list and
 * detail render it without a special case — the difference is only where the
 * row lives. Created when an issue is assigned to an agent that is bound to run
 * here, and it is never pushed to the server.
 */
export interface LocalIssue {
  issue: Issue;
  /** The agent that runs it, and how. */
  agentId: string;
  command: string;
  cwd: string;
  runStatus: LocalRunStatus;
  output: string;
}

export type LocalRunStatus = "draft" | "running" | "done" | "failed" | "stopped";

export const LOCAL_ISSUE_OUTPUT_LIMIT = 200_000;
const LOCAL_ISSUE_LIMIT = 200;

interface LocalIssuesState {
  issues: LocalIssue[];
  create: (input: {
    wsId: string;
    title: string;
    description: string | null;
    status: IssueStatus;
    priority: IssuePriority;
    agentId: string;
    agentName: string;
    command: string;
    cwd?: string;
  }) => Issue;
  update: (id: string, patch: Partial<Issue>) => void;
  updateRun: (id: string, patch: Partial<Pick<LocalIssue, "command" | "cwd">>) => void;
  remove: (id: string) => void;
  setRunStatus: (id: string, status: LocalRunStatus) => void;
  appendOutput: (id: string, chunk: string) => void;
  clearOutput: (id: string) => void;
}

export function localIssueId(): string {
  return `local-${crypto.randomUUID()}`;
}

export function isLocalIssueId(id: string): boolean {
  return id.startsWith("local-");
}

export const useLocalIssuesStore = create<LocalIssuesState>()(
  persist(
    (set, get) => ({
      issues: [],
      create: (input) => {
        const now = new Date().toISOString();
        const existing = get().issues.filter((entry) => entry.issue.workspace_id === input.wsId);
        const number = existing.reduce((max, entry) => Math.max(max, entry.issue.number), 0) + 1;
        const issue: Issue = {
          id: localIssueId(),
          workspace_id: input.wsId,
          number,
          identifier: `LOCAL-${number}`,
          title: input.title,
          description: input.description,
          status: input.status,
          priority: input.priority,
          assignee_type: "agent",
          assignee_id: input.agentId,
          creator_type: "member",
          creator_id: "",
          parent_issue_id: null,
          project_id: null,
          position: existing.length,
          stage: null,
          start_date: null,
          due_date: null,
          metadata: {},
          properties: {},
          created_at: now,
          updated_at: now,
        };
        const record: LocalIssue = {
          issue,
          agentId: input.agentId,
          command: input.command,
          cwd: input.cwd ?? "",
          runStatus: "draft",
          output: "",
        };
        set((state) => ({
          issues: [record, ...state.issues].slice(0, LOCAL_ISSUE_LIMIT),
        }));
        return issue;
      },
      update: (id, patch) =>
        set((state) => ({
          issues: state.issues.map((entry) =>
            entry.issue.id === id
              ? { ...entry, issue: { ...entry.issue, ...patch, updated_at: new Date().toISOString() } }
              : entry,
          ),
        })),
      updateRun: (id, patch) =>
        set((state) => ({
          issues: state.issues.map((entry) =>
            entry.issue.id === id ? { ...entry, ...patch } : entry,
          ),
        })),
      remove: (id) =>
        set((state) => ({ issues: state.issues.filter((entry) => entry.issue.id !== id) })),
      setRunStatus: (id, status) =>
        set((state) => ({
          issues: state.issues.map((entry) =>
            entry.issue.id === id ? { ...entry, runStatus: status } : entry,
          ),
        })),
      appendOutput: (id, chunk) =>
        set((state) => ({
          issues: state.issues.map((entry) => {
            if (entry.issue.id !== id) return entry;
            const output = entry.output + chunk;
            return {
              ...entry,
              output:
                output.length > LOCAL_ISSUE_OUTPUT_LIMIT
                  ? `…[earlier output dropped]\n${output.slice(-LOCAL_ISSUE_OUTPUT_LIMIT)}`
                  : output,
            };
          }),
        })),
      clearOutput: (id) =>
        set((state) => ({
          issues: state.issues.map((entry) =>
            entry.issue.id === id ? { ...entry, output: "" } : entry,
          ),
        })),
    }),
    { name: "multica_local_issues", version: 1, storage: createJSONStorage(() => defaultStorage) },
  ),
);

/** Every local issue in a workspace, already in the shape the board renders. */
export function selectLocalIssues(issues: LocalIssue[], wsId: string): Issue[] {
  return issues.filter((entry) => entry.issue.workspace_id === wsId).map((entry) => entry.issue);
}

/** A local issue's record, or `null` when the id belongs to the server. */
export function localIssueRecord(id: string): LocalIssue | null {
  return useLocalIssuesStore.getState().issues.find((entry) => entry.issue.id === id) ?? null;
}
