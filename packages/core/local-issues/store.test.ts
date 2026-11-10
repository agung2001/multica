// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import type { Issue } from "../types";
import {
  localIssueTasks,
  localIssueTimeline,
  localTaskRecord,
  migrateLocalIssuesState,
  useLocalIssuesStore,
} from "./store";

function issue(): Issue {
  return {
    id: "local-1",
    workspace_id: "ws-1",
    number: 1,
    identifier: "LOCAL-1",
    title: "Fix the thing",
    description: "Keep it local",
    status: "todo",
    priority: "none",
    assignee_type: "agent",
    assignee_id: "agent-1",
    creator_type: "member",
    creator_id: "user-1",
    parent_issue_id: null,
    project_id: null,
    position: 0,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

beforeEach(() => {
  useLocalIssuesStore.setState({ issues: [] });
});

describe("local issue shadow", () => {
  it("stores comments and runs in the shapes the ordinary timeline renders", () => {
    const store = useLocalIssuesStore.getState();
    const created = store.create({
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

    const comment = store.addComment(created.id, {
      authorType: "member",
      authorId: "user-1",
      content: "Please continue",
    });
    expect(comment).not.toBeNull();

    const task = store.createTask(created.id, {
      agentId: "agent-1",
      runtimeId: "rt-1",
      triggerCommentId: comment!.id,
    });
    expect(task).not.toBeNull();

    store.appendTaskOutput(created.id, task!.id, "Finished");
    store.updateTask(created.id, task!.id, {
      status: "completed",
      completed_at: "2026-01-01T00:00:02Z",
      result: { comment: "Finished" },
    });

    const record = useLocalIssuesStore.getState().issues[0]!;
    const timeline = localIssueTimeline(record);
    expect(timeline.map((entry) => entry.content)).toEqual([
      "Please continue",
      "Finished",
    ]);
    expect(timeline[1]?.source_task_id).toBe(task!.id);

    const tasks = localIssueTasks(record);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.trigger_comment_id).toBe(comment!.id);
    expect(tasks[0]?.status).toBe("completed");
    expect(localTaskRecord(task!.id)?.issue_id).toBe(created.id);
  });

  it("updates, resolves and deletes local comments without a server", () => {
    const store = useLocalIssuesStore.getState();
    const created = store.create({
      wsId: "ws-1",
      title: "Fix the thing",
      description: null,
      status: "todo",
      priority: "none",
      agentId: "agent-1",
      agentName: "Reviewer",
      runtimeId: "rt-1",
      command: "fake-agent",
    });
    const comment = store.addComment(created.id, {
      authorType: "member",
      authorId: "user-1",
      content: "First",
    })!;
    const reply = store.addComment(created.id, {
      authorType: "agent",
      authorId: "agent-1",
      content: "Answer",
      parentId: comment.id,
    })!;

    store.updateComment(created.id, comment.id, { content: "Edited" });
    store.setCommentResolved(created.id, comment.id, true, "user-1");

    let record = useLocalIssuesStore.getState().issues[0]!;
    expect(record.comments.find((entry) => entry.id === comment.id)).toMatchObject({
      content: "Edited",
      resolved_by_id: "user-1",
    });

    store.deleteComment(created.id, comment.id);
    record = useLocalIssuesStore.getState().issues[0]!;
    // The reply belongs to the deleted thread root and goes with it.
    expect(record.comments.some((entry) => entry.id === reply.id)).toBe(false);
  });
});

describe("migrateLocalIssuesState", () => {
  it("turns a v2 transcript into a normal comment and task pair", () => {
    const migrated = migrateLocalIssuesState(
      {
        issues: [
          {
            issue: issue(),
            agentId: "agent-1",
            command: "fake-agent",
            cwd: "",
            turns: [
              {
                id: "turn-1",
                prompt: "Please continue",
                output: "Finished",
                status: "done",
                error: null,
                createdAt: "2026-01-01T00:00:01Z",
              },
            ],
          },
        ],
      },
      2,
    );

    const record = migrated.issues[0]!;
    expect(record.runtimeId).toBe("");
    expect(record.comments.map((entry) => entry.content)).toEqual([
      "Please continue",
      "Finished",
    ]);
    expect(record.tasks).toHaveLength(1);
    expect(record.tasks[0]).toMatchObject({
      status: "completed",
      issue_id: "local-1",
      agent_id: "agent-1",
    });
    expect(record.comments[1]?.source_task_id).toBe(record.tasks[0]?.id);
  });
});

