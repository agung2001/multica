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
});
