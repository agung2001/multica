"use client";

import { createTranscriptFormatter, localRunRunner, splitCommandLine, type TranscriptEvent } from "../local-runs";
import type { LocalAgentBinding } from "../local-runs";
import type { ChatMessage } from "../types";
import { localChatTask, useLocalChatsStore } from "./store";

const stops = new Map<string, () => void>();
const stoppedByUser = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function appendTranscript(taskId: string, event: TranscriptEvent): void {
  const store = useLocalChatsStore.getState();
  if (event.type === "text" || event.type === "thinking" || event.type === "error") {
    store.appendTaskMessage(taskId, { type: event.type, content: event.content });
    return;
  }
  if (event.type === "tool_use") {
    store.appendTaskMessage(taskId, {
      type: "tool_use",
      tool: event.tool,
      input: event.input,
      call_id: event.callId,
    });
    return;
  }
  store.appendTaskMessage(taskId, {
    type: "tool_result",
    tool: event.tool,
    output: event.output,
    call_id: event.callId,
    output_truncated: event.output_truncated,
  });
}

/**
 * Runs one chat turn on this device.
 *
 * The chat session remains a normal server session, but this turn never enters
 * the task queue. Its live transcript and final answer live in the local chat
 * store, which the ordinary chat surfaces read alongside server messages.
 */
export function startLocalChatRun(input: {
  sessionId: string;
  agentId: string;
  binding: LocalAgentBinding;
  prompt: string;
}): string | null {
  const runner = localRunRunner();
  if (!runner) return null;
  const argv = splitCommandLine(input.binding.command);
  if (argv.length === 0) return null;

  const store = useLocalChatsStore.getState();
  const task = store.createTask(input.sessionId, input.agentId);
  let formatted = "";
  let reply = "";
  let sawEvent = false;
  const formatter = createTranscriptFormatter({
    onEvent: (event) => {
      sawEvent = true;
      appendTranscript(task.id, event);
      if (event.type === "tool_use") reply = "";
      else if (event.type === "text") reply += event.content;
    },
  });

  const handle = runner.start({
    argv,
    cwd: input.binding.cwd,
    prompt: input.prompt,
    onOutput: (chunk) => {
      formatted += formatter.write(chunk);
    },
    onExit: (result) => {
      stops.delete(task.id);
      const stopped = stoppedByUser.delete(task.id);
      formatted += formatter.finish();
      const answer = (sawEvent ? reply : formatted).trim();
      const status = stopped
        ? "cancelled"
        : result.error || result.code !== 0
          ? "failed"
          : "completed";

      if (answer) {
        const message: ChatMessage = {
          id: `local-chat-message-${crypto.randomUUID()}`,
          chat_session_id: input.sessionId,
          role: "assistant",
          content: answer,
          task_id: task.id,
          created_at: nowIso(),
        };
        useLocalChatsStore.getState().appendMessage(input.sessionId, input.agentId, message);
      } else if (status === "failed") {
        const message: ChatMessage = {
          id: `local-chat-message-${crypto.randomUUID()}`,
          chat_session_id: input.sessionId,
          role: "assistant",
          content: result.error || "The local agent failed.",
          task_id: task.id,
          created_at: nowIso(),
          failure_reason: "agent_error",
        };
        useLocalChatsStore.getState().appendMessage(input.sessionId, input.agentId, message);
      }

      useLocalChatsStore.getState().updateTask(task.id, {
        status,
        completedAt: nowIso(),
        error: stopped ? null : result.error ?? null,
      });
    },
  });

  stops.set(task.id, handle.stop);
  return task.id;
}

export function stopLocalChatTask(taskId: string): void {
  const stop = stops.get(taskId);
  if (!stop) return;
  stoppedByUser.add(taskId);
  stop();
  stops.delete(taskId);
  const task = localChatTask(taskId);
  if (!task) return;
  useLocalChatsStore.getState().updateTask(taskId, {
    status: "cancelled",
    completedAt: nowIso(),
    error: null,
  });
}
