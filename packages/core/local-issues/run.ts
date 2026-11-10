"use client";

import {
  createTranscriptFormatter,
  localRunRunner,
  splitCommandLine,
  type TranscriptEvent,
} from "../local-runs";
import {
  localIssueRecord,
  localTaskRecord,
  useLocalIssuesStore,
  type LocalIssue,
} from "./store";

/**
 * Runs that belong to a local issue, keyed by local task id.
 *
 * The program is a child of the app window, not of the server, so the run has
 * to be tracked here: the store cannot stop something it only knows a string
 * about.
 */
const stops = new Map<string, () => void>();
/** Tasks the user ended by hand, so a signal is not reported as a failure. */
const stoppedByUser = new Set<string>();

const ACTIVE_TASK_STATUSES = new Set(["queued", "dispatched", "running", "waiting_local_directory"]);

/**
 * Starts a run against the agent for this issue.
 *
 * The prompt carries the issue itself (title and description) because each
 * launch is a fresh process: the agent only knows what this string says plus
 * the feedback the user just typed. The run is stored in the same task and
 * comment shapes the server uses, so the ordinary timeline renders it.
 */
export function startLocalIssueRun(
  issueId: string,
  feedback?: string,
  triggerCommentId?: string | null,
): boolean {
  const record = localIssueRecord(issueId);
  const runner = localRunRunner();
  if (!record || !runner) return false;

  const argv = splitCommandLine(record.command);
  if (argv.length === 0) return false;

  // What the CLI receives repeats the issue each time (every launch is a new
  // process); the timeline shows the line the person actually wrote plus the
  // agent's answer.
  const prompt = [
    record.issue.title,
    record.issue.description?.trim(),
    feedback?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  const store = useLocalIssuesStore.getState();
  const task = store.createTask(issueId, {
    agentId: record.agentId,
    runtimeId: record.runtimeId,
    triggerCommentId,
    triggerSummary: feedback?.trim() || record.issue.title,
  });
  if (!task) return false;

  // Every CLI on the list streams protocol JSON; the formatter is what turns
  // it into the conversation the run block shows. Tool activity goes to the
  // transcript, while the reply comment stays the final answer only — the same
  // separation a server run has.
  let formatted = "";
  let reply = "";
  let sawEvent = false;
  const formatter = createTranscriptFormatter({
    onEvent: (event) => {
      sawEvent = true;
      appendTranscript(issueId, task.id, event);
      if (event.type === "tool_use") {
        // The final result is the text after the last tool call, not the
        // narration that preceded it.
        reply = "";
      } else if (event.type === "text") {
        reply += event.content;
      }
    },
  });

  const handle = runner.start({
    argv,
    cwd: record.cwd,
    prompt,
    onOutput: (chunk) => {
      formatted += formatter.write(chunk);
    },
    onExit: (result) => {
      stops.delete(task.id);
      const stopped = stoppedByUser.delete(task.id);
      formatted += formatter.finish();
      // A plain-text CLI produces no structured events; its whole output is
      // the answer. Structured runs only publish the final text segment.
      const answer = sawEvent ? reply : formatted;
      if (answer.trim()) {
        useLocalIssuesStore.getState().appendTaskOutput(issueId, task.id, answer);
      }
      const status = stopped
        ? "cancelled"
        : result.error || result.code !== 0
          ? "failed"
          : "completed";
      useLocalIssuesStore.getState().updateTask(issueId, task.id, {
        status,
        completed_at: new Date().toISOString(),
        result: status === "completed" && answer.trim() ? { comment: answer } : null,
        error: stopped ? null : (result.error ?? null),
        failure_reason: status === "failed" ? "agent_error" : undefined,
        cancelled_by: stopped ? { type: "member" } : undefined,
      });
    },
  });

  stops.set(task.id, handle.stop);
  return true;
}

function appendTranscript(
  issueId: string,
  taskId: string,
  event: TranscriptEvent,
): void {
  const store = useLocalIssuesStore.getState();
  if (event.type === "text" || event.type === "thinking" || event.type === "error") {
    store.appendTaskMessage(issueId, taskId, {
      type: event.type,
      content: event.content,
    });
    return;
  }
  if (event.type === "tool_use") {
    store.appendTaskMessage(issueId, taskId, {
      type: "tool_use",
      tool: event.tool,
      input: event.input,
      call_id: event.callId,
    });
    return;
  }
  store.appendTaskMessage(issueId, taskId, {
    type: "tool_result",
    tool: event.tool,
    output: event.output,
    call_id: event.callId,
    output_truncated: event.output_truncated,
  });
}

export function stopLocalIssueRun(taskId: string): void {
  const task = localTaskRecord(taskId);
  const stop = stops.get(taskId);
  if (!stop) return;
  stoppedByUser.add(taskId);
  stop();
  stops.delete(taskId);
  if (!task) return;
  useLocalIssuesStore.getState().updateTask(task.issue_id, taskId, {
    status: "cancelled",
    completed_at: new Date().toISOString(),
    cancelled_by: { type: "member" },
    error: null,
  });
}

/**
 * Runs the same input again as a new task.
 *
 * A retry is a fresh launch, not a resume: the previous reply stays in the
 * timeline and the new run answers the same trigger comment.
 */
export function retryLocalIssueRun(taskId: string): boolean {
  const task = localTaskRecord(taskId);
  if (!task) return false;
  const record = localIssueRecord(task.issue_id);
  if (!record) return false;
  const triggerComment = task.trigger_comment_id
    ? record.comments.find((comment) => comment.id === task.trigger_comment_id)
    : null;
  return startLocalIssueRun(
    task.issue_id,
    triggerComment?.content,
    task.trigger_comment_id ?? null,
  );
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

export function hasActiveLocalTask(record: LocalIssue | null): boolean {
  return (record?.tasks ?? []).some((task) => ACTIVE_TASK_STATUSES.has(task.status));
}
