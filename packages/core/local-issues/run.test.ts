// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startLocalIssueRun } from "./run";
import { useLocalIssuesStore } from "./store";

let emitOutput: ((runId: string, chunk: string) => void) | null = null;
let emitExit: ((runId: string, result: { code: number | null; error?: string }) => void) | null =
  null;

const localRunAPI = {
  start: vi.fn(async () => ({ runId: "run-1" })),
  stop: vi.fn(),
  onOutput: vi.fn((callback: (runId: string, chunk: string) => void) => {
    emitOutput = callback;
    return () => {
      emitOutput = null;
    };
  }),
  onExit: vi.fn(
    (callback: (runId: string, result: { code: number | null; error?: string }) => void) => {
      emitExit = callback;
      return () => {
        emitExit = null;
      };
    },
  ),
};

beforeEach(() => {
  useLocalIssuesStore.setState({ issues: [] });
  (window as unknown as { localRunAPI: typeof localRunAPI }).localRunAPI = localRunAPI;
});

afterEach(() => {
  delete (window as unknown as { localRunAPI?: typeof localRunAPI }).localRunAPI;
  vi.clearAllMocks();
});

function createLocalIssue() {
  return useLocalIssuesStore.getState().create({
    wsId: "ws-1",
    title: "Fix the thing",
    description: "Keep it local",
    status: "todo",
    priority: "none",
    agentId: "agent-1",
    agentName: "Reviewer",
    runtimeId: "rt-1",
    command: "fake-agent",
  });
}

describe("local issue runs", () => {
  it("writes the run and its streamed answer into the normal task/comment shapes", async () => {
    const issue = createLocalIssue();

    expect(startLocalIssueRun(issue.id)).toBe(true);
    await Promise.resolve();

    const task = useLocalIssuesStore.getState().issues[0]?.tasks[0];
    expect(task).toMatchObject({
      agent_id: "agent-1",
      runtime_id: "rt-1",
      issue_id: issue.id,
      status: "running",
    });
    expect(task?.trigger_comment_id).toBeUndefined();

    emitOutput?.("run-1", "hello\n");
    emitExit?.("run-1", { code: 0 });

    const record = useLocalIssuesStore.getState().issues[0]!;
    expect(record.tasks[0]?.status).toBe("completed");
    expect(record.tasks[0]?.result).toEqual({ comment: "hello\n" });
    expect(record.comments).toHaveLength(1);
    expect(record.comments[0]).toMatchObject({
      author_type: "agent",
      author_id: "agent-1",
      content: "hello\n",
      source_task_id: task?.id,
    });
  });

  it("streams tool commands and results into the run transcript", async () => {
    const issue = createLocalIssue();

    expect(startLocalIssueRun(issue.id)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    emitOutput?.(
      "run-1",
      `${JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "bash",
        args: { command: "ls -la" },
      })}\n`,
    );

    let record = useLocalIssuesStore.getState().issues[0]!;
    // Tool activity does not become the reply; it stays in the run transcript.
    expect(record.comments).toHaveLength(0);
    expect(record.messages).toHaveLength(1);
    expect(record.messages[0]).toMatchObject({
      type: "tool_use",
      tool: "bash",
      input: { command: "ls -la" },
      call_id: "call-1",
    });

    emitOutput?.(
      "run-1",
      `${JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "bash",
        result: "file.txt",
      })}\n`,
    );
    emitOutput?.(
      "run-1",
      `${JSON.stringify({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "Found it." },
      })}\n`,
    );
    emitExit?.("run-1", { code: 0 });

    record = useLocalIssuesStore.getState().issues[0]!;
    expect(record.messages[1]).toMatchObject({
      type: "tool_result",
      tool: "bash",
      output: "file.txt",
      call_id: "call-1",
    });
    expect(record.messages[2]).toMatchObject({
      type: "text",
      content: "Found it.",
    });
    expect(record.comments).toHaveLength(1);
    expect(record.comments[0]?.content).toBe("Found it.");
    expect(record.tasks[0]?.status).toBe("completed");
    expect(record.tasks[0]?.result).toEqual({ comment: "Found it." });
  });
});
