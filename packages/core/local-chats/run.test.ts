// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLocalChatRun } from "./run";
import { localChatPendingTask, useLocalChatsStore } from "./store";

let emitOutput: ((runId: string, chunk: string) => void) | null = null;
let emitExit: ((runId: string, result: { code: number | null; error?: string }) => void) | null = null;

const localRunAPI = {
  start: vi.fn(async () => ({ runId: "run-1" })),
  stop: vi.fn(),
  onOutput: vi.fn((callback: (runId: string, chunk: string) => void) => {
    emitOutput = callback;
    return () => { emitOutput = null; };
  }),
  onExit: vi.fn((callback: (runId: string, result: { code: number | null; error?: string }) => void) => {
    emitExit = callback;
    return () => { emitExit = null; };
  }),
};

beforeEach(() => {
  useLocalChatsStore.setState({ sessions: {}, tasks: {} });
  (window as unknown as { localRunAPI: typeof localRunAPI }).localRunAPI = localRunAPI;
});

afterEach(() => {
  delete (window as unknown as { localRunAPI?: typeof localRunAPI }).localRunAPI;
  vi.clearAllMocks();
});

describe("local chat runs", () => {
  it("streams tool activity locally and appends only the final answer", async () => {
    const taskId = startLocalChatRun({
      sessionId: "session-1",
      agentId: "agent-1",
      binding: { runtimeId: "rt-1", provider: "pi", command: "fake-agent", cwd: "" },
      prompt: "Read the file",
    });
    expect(taskId).toBeTruthy();
    expect(localChatPendingTask("session-1")?.id).toBe(taskId);
    await Promise.resolve();
    await Promise.resolve();

    emitOutput?.("run-1", `${JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "bash",
      args: { command: "cat file.txt" },
    })}\n`);
    emitOutput?.("run-1", `${JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "bash",
      result: "contents",
    })}\n`);
    emitOutput?.("run-1", `${JSON.stringify({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "The file says contents." },
    })}\n`);
    emitExit?.("run-1", { code: 0 });

    const session = useLocalChatsStore.getState().sessions["session-1"]!;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]).toMatchObject({
      role: "assistant",
      content: "The file says contents.",
      task_id: taskId,
    });
    expect(localChatPendingTask("session-1")).toBeNull();
    expect(useLocalChatsStore.getState().tasks[taskId!]?.status).toBe("completed");
    expect(useLocalChatsStore.getState().tasks[taskId!]?.messages.map((m) => m.type))
      .toEqual(["tool_use", "tool_result", "text"]);
  });

  it("can stop an active local chat run", async () => {
    const taskId = startLocalChatRun({
      sessionId: "session-1",
      agentId: "agent-1",
      binding: { runtimeId: "rt-1", provider: "pi", command: "fake-agent", cwd: "" },
      prompt: "Keep going",
    })!;
    await Promise.resolve();
    const { stopLocalChatTask } = await import("./run");
    stopLocalChatTask(taskId);

    expect(localRunAPI.stop).toHaveBeenCalledWith("run-1");
    expect(useLocalChatsStore.getState().tasks[taskId]?.status).toBe("cancelled");
    expect(localChatPendingTask("session-1")).toBeNull();
  });
});
