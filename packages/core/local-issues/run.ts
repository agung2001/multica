"use client";

import { localRunRunner, splitCommandLine } from "../local-runs";
import { localIssueRecord, useLocalIssuesStore } from "./store";

/**
 * Runs that belong to a local issue, keyed by issue id.
 *
 * The program is a child of the app window, not of the server, so the run has
 * to be tracked here: the store cannot stop something it only knows a string
 * about.
 */
const stops = new Map<string, () => void>();

/**
 * Starts a round against the agent for this issue.
 *
 * The prompt carries the issue itself (title and description) because each
 * launch is a fresh process: the agent only knows what this string says plus
 * the feedback the user just typed.
 */
export function startLocalIssueRun(issueId: string, feedback?: string): boolean {
  const record = localIssueRecord(issueId);
  const runner = localRunRunner();
  if (!record || !runner || stops.has(issueId)) return false;

  const argv = splitCommandLine(record.command);
  if (argv.length === 0) return false;

  const prompt = [
    record.issue.title,
    record.issue.description?.trim(),
    feedback?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  const store = useLocalIssuesStore.getState();
  const turnId = store.beginTurn(issueId, prompt);

  const handle = runner.start({
    argv,
    cwd: record.cwd,
    prompt,
    onOutput: (chunk) => useLocalIssuesStore.getState().appendTurnOutput(issueId, turnId, chunk),
    onExit: (result) => {
      stops.delete(issueId);
      useLocalIssuesStore
        .getState()
        .endTurn(issueId, turnId, result.error || result.code !== 0 ? "failed" : "done", result.error ?? null);
    },
  });

  stops.set(issueId, handle.stop);
  return true;
}

export function stopLocalIssueRun(issueId: string): void {
  const stop = stops.get(issueId);
  if (!stop) return;
  stop();
  stops.delete(issueId);
}

/**
 * Queues the first round for a freshly created local issue.
 *
 * Assigning an agent to a normal issue starts work immediately; a local issue
 * must do the same or the two behave differently for no reason the user can
 * see.
 */
export function autoRunLocalIssue(issueId: string): void {
  // The spawn is synchronous but the turn subscription is not; a microtask
  // keeps the create mutation's own state updates ahead of the first chunk.
  queueMicrotask(() => {
    startLocalIssueRun(issueId);
  });
}
