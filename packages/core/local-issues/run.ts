"use client";

import { createTranscriptFormatter, localRunRunner, splitCommandLine } from "../local-runs";
import { localIssueRecord, useLocalIssuesStore } from "./store";

/**
 * Runs that belong to a local issue, keyed by issue id.
 *
 * The program is a child of the app window, not of the server, so the run has
 * to be tracked here: the store cannot stop something it only knows a string
 * about.
 */
const stops = new Map<string, () => void>();
/** Issues the user ended by hand, so a signal is not reported as a failure. */
const stoppedByUser = new Set<string>();

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

  // What the CLI receives repeats the issue each time (every launch is a new
  // process); what the feed shows is the line the person actually wrote.
  const prompt = [
    record.issue.title,
    record.issue.description?.trim(),
    feedback?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  const display = feedback?.trim() || record.issue.title;

  const store = useLocalIssuesStore.getState();
  const turnId = store.beginTurn(issueId, display);
  // Every CLI on the list streams protocol JSON; the formatter is what turns
  // it into the conversation the run block shows.
  const formatter = createTranscriptFormatter();

  const handle = runner.start({
    argv,
    cwd: record.cwd,
    prompt,
    onOutput: (chunk) => {
      const text = formatter.write(chunk);
      if (text) useLocalIssuesStore.getState().appendTurnOutput(issueId, turnId, text);
    },
    onExit: (result) => {
      stops.delete(issueId);
      const stopped = stoppedByUser.delete(issueId);
      const tail = formatter.finish();
      if (tail) useLocalIssuesStore.getState().appendTurnOutput(issueId, turnId, tail);
      const status = stopped
        ? "stopped"
        : result.error || result.code !== 0
          ? "failed"
          : "done";
      useLocalIssuesStore
        .getState()
        .endTurn(issueId, turnId, status, stopped ? null : (result.error ?? null));
    },
  });

  stops.set(issueId, handle.stop);
  return true;
}

export function stopLocalIssueRun(issueId: string): void {
  const stop = stops.get(issueId);
  if (!stop) return;
  stoppedByUser.add(issueId);
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
