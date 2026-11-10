"use client";

import type { CreateIssueRequest } from "../types";
import { useLocalRunsStore } from "../local-runs";
import { useLocalIssuesStore } from "./store";

/**
 * Creates the issue on this device instead of on the server when it is assigned
 * to an agent bound to run here.
 *
 * Returns `null` for every other case, leaving the caller to post it normally.
 * This is the whole reason local issues exist: an issue whose agent runs on
 * this machine must not be enqueued for a daemon that will never pick it up.
 */
export function createLocalIssueIfBound(
  wsId: string,
  data: CreateIssueRequest,
): ReturnType<typeof useLocalIssuesStore.getState>["issues"][number]["issue"] | null {
  if (data.assignee_type !== "agent" || !data.assignee_id) return null;
  const binding = useLocalRunsStore.getState().bindings[data.assignee_id];
  // A binding without a command cannot run anything, so the issue is better
  // off on the server where its agent still has a runtime.
  if (!binding || !binding.command.trim()) return null;

  return useLocalIssuesStore.getState().create({
    wsId,
    title: data.title,
    description: data.description ?? null,
    status: data.status ?? "todo",
    priority: data.priority ?? "none",
    agentId: data.assignee_id,
    agentName: "",
    runtimeId: binding.runtimeId,
    command: binding.command,
    cwd: binding.cwd,
  });
}
