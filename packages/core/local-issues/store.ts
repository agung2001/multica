"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type {
  AgentTask,
  Comment,
  Issue,
  IssuePriority,
  IssueStatus,
  Reaction,
  TaskMessagePayload,
  TimelineEntry,
} from "../types";
import { defaultStorage } from "../platform/storage";

/**
 * An issue that exists only on this device.
 *
 * It is shaped exactly like a server issue so the ordinary board, list and
 * detail render it without a special case — the difference is only where the
 * row lives. Its timeline and runs mirror the server shapes too, so the normal
 * comment and execution components render it rather than a private UI.
 */
export interface LocalIssue {
  issue: Issue;
  /** The agent that runs it, and how. */
  agentId: string;
  runtimeId: string;
  command: string;
  cwd: string;
  /** Comments in the same shape the server timeline returns. */
  comments: Comment[];
  /** Runs in the same shape the server task list returns. */
  tasks: AgentTask[];
  /** Execution transcript in the shape the run block already renders. */
  messages: TaskMessagePayload[];
}

export const LOCAL_ISSUE_OUTPUT_LIMIT = 200_000;
const LOCAL_ISSUE_LIMIT = 200;

export interface LocalIssueCreateInput {
  wsId: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  agentId: string;
  agentName: string;
  runtimeId: string;
  command: string;
  cwd?: string;
}

export interface LocalIssueCommentInput {
  authorType: Comment["author_type"];
  authorId: string;
  content: string;
  parentId?: string | null;
  type?: Comment["type"];
  sourceTaskId?: string | null;
}

export interface LocalIssueTaskInput {
  agentId: string;
  runtimeId: string;
  triggerCommentId?: string | null;
  triggerSummary?: string | null;
  status?: AgentTask["status"];
}

interface LocalIssuesState {
  issues: LocalIssue[];
  create: (input: LocalIssueCreateInput) => Issue;
  update: (id: string, patch: Partial<Issue>) => void;
  updateRun: (
    id: string,
    patch: Partial<Pick<LocalIssue, "runtimeId" | "command" | "cwd">>,
  ) => void;
  remove: (id: string) => void;
  addComment: (id: string, input: LocalIssueCommentInput) => Comment | null;
  updateComment: (
    id: string,
    commentId: string,
    patch: Partial<Pick<Comment, "content" | "attachments">>,
  ) => Comment | null;
  deleteComment: (id: string, commentId: string) => void;
  setCommentResolved: (
    id: string,
    commentId: string,
    resolved: boolean,
    actorId: string,
  ) => void;
  toggleCommentReaction: (
    id: string,
    commentId: string,
    emoji: string,
    actorId: string,
    existingReactionId?: string,
  ) => Reaction | null;
  createTask: (id: string, input: LocalIssueTaskInput) => AgentTask | null;
  updateTask: (id: string, taskId: string, patch: Partial<AgentTask>) => void;
  appendTaskOutput: (id: string, taskId: string, chunk: string) => void;
  appendTaskMessage: (
    id: string,
    taskId: string,
    message: Omit<LocalTaskMessage, "task_id" | "issue_id" | "seq" | "created_at"> & {
      created_at?: string;
    },
  ) => void;
}

type LocalTaskMessage = TaskMessagePayload;

const EMPTY_ISSUES: LocalIssue[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function capOutput(output: string): string {
  return output.length > LOCAL_ISSUE_OUTPUT_LIMIT
    ? `…[earlier output dropped]\n${output.slice(-LOCAL_ISSUE_OUTPUT_LIMIT)}`
    : output;
}

function commentToTimelineEntry(comment: Comment): TimelineEntry {
  return {
    type: "comment",
    id: comment.id,
    actor_type: comment.author_type,
    actor_id: comment.author_id,
    content: comment.content,
    parent_id: comment.parent_id,
    created_at: comment.created_at,
    updated_at: comment.updated_at,
    revision: comment.revision,
    comment_type: comment.type,
    reactions: comment.reactions,
    attachments: comment.attachments,
    resolved_at: comment.resolved_at,
    resolved_by_type: comment.resolved_by_type,
    resolved_by_id: comment.resolved_by_id,
    source_task_id: comment.source_task_id,
    deleted_at: comment.deleted_at,
  };
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
        const now = nowIso();
        const existing = get().issues.filter(
          (entry) => entry.issue.workspace_id === input.wsId,
        );
        const number =
          existing.reduce((max, entry) => Math.max(max, entry.issue.number), 0) + 1;
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
          runtimeId: input.runtimeId,
          command: input.command,
          cwd: input.cwd ?? "",
          comments: [],
          tasks: [],
          messages: [],
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
              ? {
                  ...entry,
                  issue: {
                    ...entry.issue,
                    ...patch,
                    updated_at: nowIso(),
                  },
                }
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
        set((state) => ({
          issues: state.issues.filter((entry) => entry.issue.id !== id),
        })),
      addComment: (id, input) => {
        const entry = get().issues.find((candidate) => candidate.issue.id === id);
        if (!entry) return null;
        const now = nowIso();
        const comment: Comment = {
          id: crypto.randomUUID(),
          issue_id: id,
          author_type: input.authorType,
          author_id: input.authorId,
          content: input.content,
          type: input.type ?? "comment",
          parent_id: input.parentId ?? null,
          reactions: [],
          attachments: [],
          created_at: now,
          updated_at: now,
          resolved_at: null,
          resolved_by_type: null,
          resolved_by_id: null,
          source_task_id: input.sourceTaskId ?? null,
        };
        set((state) => ({
          issues: state.issues.map((candidate) =>
            candidate.issue.id === id
              ? { ...candidate, comments: [...candidate.comments, comment] }
              : candidate,
          ),
        }));
        return comment;
      },
      updateComment: (id, commentId, patch) => {
        let updated: Comment | null = null;
        set((state) => ({
          issues: state.issues.map((entry) => {
            if (entry.issue.id !== id) return entry;
            return {
              ...entry,
              comments: entry.comments.map((comment) => {
                if (comment.id !== commentId) return comment;
                updated = { ...comment, ...patch, updated_at: nowIso() };
                return updated;
              }),
            };
          }),
        }));
        return updated;
      },
      deleteComment: (id, commentId) =>
        set((state) => ({
          issues: state.issues.map((entry) => {
            if (entry.issue.id !== id) return entry;
            const removed = new Set([commentId]);
            let changed = true;
            while (changed) {
              changed = false;
              for (const comment of entry.comments) {
                if (
                  comment.parent_id &&
                  removed.has(comment.parent_id) &&
                  !removed.has(comment.id)
                ) {
                  removed.add(comment.id);
                  changed = true;
                }
              }
            }
            return {
              ...entry,
              comments: entry.comments.filter((comment) => !removed.has(comment.id)),
            };
          }),
        })),
      setCommentResolved: (id, commentId, resolved, actorId) =>
        set((state) => ({
          issues: state.issues.map((entry) => {
            if (entry.issue.id !== id) return entry;
            return {
              ...entry,
              comments: entry.comments.map((comment) =>
                comment.id === commentId
                  ? {
                      ...comment,
                      resolved_at: resolved ? nowIso() : null,
                      resolved_by_type: resolved ? "member" : null,
                      resolved_by_id: resolved ? actorId : null,
                      updated_at: nowIso(),
                    }
                  : comment,
              ),
            };
          }),
        })),
      toggleCommentReaction: (id, commentId, emoji, actorId, existingReactionId) => {
        let result: Reaction | null = null;
        set((state) => ({
          issues: state.issues.map((entry) => {
            if (entry.issue.id !== id) return entry;
            return {
              ...entry,
              comments: entry.comments.map((comment) => {
                if (comment.id !== commentId) return comment;
                if (existingReactionId) {
                  return {
                    ...comment,
                    reactions: comment.reactions.filter(
                      (reaction) => reaction.id !== existingReactionId,
                    ),
                  };
                }
                result = {
                  id: crypto.randomUUID(),
                  comment_id: commentId,
                  actor_type: "member",
                  actor_id: actorId,
                  emoji,
                  created_at: nowIso(),
                };
                return {
                  ...comment,
                  reactions: [...comment.reactions, result],
                };
              }),
            };
          }),
        }));
        return result;
      },
      createTask: (id, input) => {
        const entry = get().issues.find((candidate) => candidate.issue.id === id);
        if (!entry) return null;
        const now = nowIso();
        const task: AgentTask = {
          id: crypto.randomUUID(),
          agent_id: input.agentId,
          runtime_id: input.runtimeId,
          issue_id: id,
          status: input.status ?? "running",
          priority: 0,
          dispatched_at: now,
          started_at: now,
          completed_at: null,
          result: null,
          error: null,
          created_at: now,
          trigger_comment_id: input.triggerCommentId ?? undefined,
          trigger_summary: input.triggerSummary ?? undefined,
          kind: input.triggerCommentId ? "comment" : "direct",
          delivered_comment_ids: input.triggerCommentId
            ? [input.triggerCommentId]
            : undefined,
        };
        set((state) => ({
          issues: state.issues.map((candidate) =>
            candidate.issue.id === id
              ? { ...candidate, tasks: [...candidate.tasks, task] }
              : candidate,
          ),
        }));
        return task;
      },
      updateTask: (id, taskId, patch) =>
        set((state) => ({
          issues: state.issues.map((entry) =>
            entry.issue.id === id
              ? {
                  ...entry,
                  tasks: entry.tasks.map((task) =>
                    task.id === taskId ? { ...task, ...patch } : task,
                  ),
                }
              : entry,
          ),
        })),
      appendTaskOutput: (id, taskId, chunk) => {
        if (!chunk) return;
        set((state) => ({
          issues: state.issues.map((entry) => {
            if (entry.issue.id !== id) return entry;
            let existed = false;
            const comments = entry.comments.map((comment) => {
              if (
                comment.source_task_id !== taskId ||
                comment.author_type !== "agent"
              ) {
                return comment;
              }
              existed = true;
              return {
                ...comment,
                content: capOutput(comment.content + chunk),
                updated_at: nowIso(),
              };
            });
            if (existed) return { ...entry, comments };
            const now = nowIso();
            const comment: Comment = {
              id: crypto.randomUUID(),
              issue_id: id,
              author_type: "agent",
              author_id: entry.agentId,
              content: capOutput(chunk),
              type: "comment",
              parent_id: null,
              reactions: [],
              attachments: [],
              created_at: now,
              updated_at: now,
              resolved_at: null,
              resolved_by_type: null,
              resolved_by_id: null,
              source_task_id: taskId,
            };
            return { ...entry, comments: [...entry.comments, comment] };
          }),
        }));
      },
      appendTaskMessage: (id, taskId, message) => {
        set((state) => ({
          issues: state.issues.map((entry) => {
            if (entry.issue.id !== id) return entry;
            const previous = entry.messages.at(-1);
            // Text and thinking arrive token by token. Folding adjacent
            // fragments keeps a long answer from becoming thousands of rows;
            // tool events remain separate so the run block pairs calls and
            // results by order.
            if (
              previous &&
              previous.task_id === taskId &&
              previous.type === message.type &&
              (message.type === "text" || message.type === "thinking")
            ) {
              return {
                ...entry,
                messages: [
                  ...entry.messages.slice(0, -1),
                  {
                    ...previous,
                    content: capOutput(
                      (previous.content ?? "") + (message.content ?? ""),
                    ),
                    created_at: message.created_at ?? nowIso(),
                  },
                ],
              };
            }
            const seq =
              entry.messages.reduce((max, item) => Math.max(max, item.seq), 0) + 1;
            return {
              ...entry,
              messages: [
                ...entry.messages,
                {
                  ...message,
                  task_id: taskId,
                  issue_id: id,
                  seq,
                  created_at: message.created_at ?? nowIso(),
                },
              ],
            };
          }),
        }));
      },
    }),
    {
      name: "multica_local_issues",
      version: 4,
      storage: createJSONStorage(() => defaultStorage),
      migrate: migrateLocalIssuesState,
    },
  ),
);

/**
 * Every local issue in a workspace, already in the shape the board renders.
 */
export function selectLocalIssues(issues: LocalIssue[], wsId: string): Issue[] {
  return issues
    .filter((entry) => entry.issue.workspace_id === wsId)
    .map((entry) => entry.issue);
}

/**
 * A local issue's record, or `null` when it belongs to the server.
 *
 * Matches either the id or the `LOCAL-1` identifier: the detail route resolves
 * a URL segment that can be either, exactly like a server issue.
 */
export function localIssueRecord(idOrIdentifier: string): LocalIssue | null {
  return (
    useLocalIssuesStore.getState().issues.find(
      (entry) =>
        entry.issue.id === idOrIdentifier ||
        entry.issue.identifier === idOrIdentifier,
    ) ?? null
  );
}

/** The transcript behind a local run, in the shape the run block renders. */
export function localTaskMessages(taskId: string): TaskMessagePayload[] {
  for (const entry of useLocalIssuesStore.getState().issues) {
    if (entry.tasks.some((task) => task.id === taskId)) {
      return entry.messages.filter((message) => message.task_id === taskId);
    }
  }
  return EMPTY_MESSAGES;
}

const EMPTY_MESSAGES: TaskMessagePayload[] = [];

/** Subscribe a run block to a local transcript as it streams. */
export function useLocalTaskMessages(taskId: string | null): TaskMessagePayload[] {
  return useLocalIssuesStore(
    useShallow((state) => {
      if (!taskId) return EMPTY_MESSAGES;
      for (const entry of state.issues) {
        if (!entry.tasks.some((task) => task.id === taskId)) continue;
        return entry.messages.filter((message) => message.task_id === taskId);
      }
      return EMPTY_MESSAGES;
    }),
  );
}

/** The task behind a local run, or `null` for a server task id. */
export function localTaskRecord(taskId: string): AgentTask | null {
  for (const entry of useLocalIssuesStore.getState().issues) {
    const task = entry.tasks.find((candidate) => candidate.id === taskId);
    if (task) return task;
  }
  return null;
}

export function isLocalTaskId(taskId: string): boolean {
  return localTaskRecord(taskId) !== null;
}

export function localIssueTimeline(record: LocalIssue | null): TimelineEntry[] {
  if (!record) return [];
  return record.comments
    .map(commentToTimelineEntry)
    .sort((left, right) =>
      left.created_at === right.created_at
        ? left.id.localeCompare(right.id)
        : left.created_at.localeCompare(right.created_at),
    );
}

export function localIssueTasks(record: LocalIssue | null): AgentTask[] {
  if (!record) return [];
  return [...record.tasks].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) ||
    left.id.localeCompare(right.id),
  );
}

export function localIssueComments(issueId: string): Comment[] {
  return localIssueRecord(issueId)?.comments ?? [];
}

export function emptyLocalIssues(): LocalIssue[] {
  return EMPTY_ISSUES;
}

/** v1 kept one transcript per issue; v2 kept unpinned turns. Both become comments + tasks. */
export function migrateLocalIssuesState(
  persisted: unknown,
  version: number,
): LocalIssuesState {
  const state = persisted as
    | { issues?: unknown[] }
    | undefined;
  if (!Array.isArray(state?.issues)) return state as LocalIssuesState;
  return {
    ...state,
    issues: state.issues.map((raw) => migrateLocalIssue(raw, version)),
  } as LocalIssuesState;
}

function migrateLocalIssue(raw: unknown, version: number): LocalIssue {
  const entry = raw as LocalIssue & {
    turns?: Array<{
      id: string;
      prompt: string;
      output: string;
      status: string;
      error: string | null;
      createdAt: string;
    }>;
    runStatus?: string;
    output?: string;
  };
  const existingComments = Array.isArray(entry.comments) ? entry.comments : [];
  const existingTasks = Array.isArray(entry.tasks) ? entry.tasks : [];
  const existingMessages = Array.isArray(entry.messages) ? entry.messages : [];
  if (version >= 3 && existingComments.length > 0) {
    return {
      ...entry,
      runtimeId: entry.runtimeId ?? "",
      comments: existingComments,
      tasks: existingTasks,
      messages: existingMessages,
    };
  }

  let turns = Array.isArray(entry.turns) ? entry.turns : [];
  if (version < 2 && !turns.length && entry.output) {
    turns = [
      {
        id: `turn-${crypto.randomUUID()}`,
        prompt: entry.issue?.title ?? "",
        output: entry.output,
        status: entry.runStatus ?? "draft",
        error: null,
        createdAt: entry.issue?.created_at ?? nowIso(),
      },
    ];
  }

  const comments: Comment[] = [];
  const tasks: AgentTask[] = [];
  for (const turn of turns) {
    const createdAt = turn.createdAt || nowIso();
    if (turn.prompt.trim()) {
      comments.push({
        id: crypto.randomUUID(),
        issue_id: entry.issue.id,
        author_type: "member",
        author_id: entry.issue.creator_id,
        content: turn.prompt,
        type: "comment",
        parent_id: null,
        reactions: [],
        attachments: [],
        created_at: createdAt,
        updated_at: createdAt,
        resolved_at: null,
        resolved_by_type: null,
        resolved_by_id: null,
        source_task_id: null,
      });
    }
    const status = migratedTaskStatus(turn.status);
    const taskId = crypto.randomUUID();
    tasks.push({
      id: taskId,
      agent_id: entry.agentId,
      runtime_id: entry.runtimeId ?? "",
      issue_id: entry.issue.id,
      status,
      priority: 0,
      dispatched_at: status === "cancelled" ? null : createdAt,
      started_at: status === "cancelled" ? null : createdAt,
      completed_at:
        status === "completed" || status === "failed" || status === "cancelled"
          ? createdAt
          : null,
      result:
        status === "completed" && turn.output
          ? { comment: turn.output }
          : null,
      error: turn.error,
      created_at: createdAt,
      trigger_comment_id: comments.at(-1)?.id,
      kind: "comment",
    });
    if (turn.output) {
      comments.push({
        id: crypto.randomUUID(),
        issue_id: entry.issue.id,
        author_type: "agent",
        author_id: entry.agentId,
        content: capOutput(turn.output),
        type: status === "failed" || status === "cancelled" ? "system" : "comment",
        parent_id: null,
        reactions: [],
        attachments: [],
        created_at: createdAt,
        updated_at: createdAt,
        resolved_at: null,
        resolved_by_type: null,
        resolved_by_id: null,
        source_task_id: taskId,
      });
    }
  }

  return {
    issue: entry.issue,
    agentId: entry.agentId,
    runtimeId: entry.runtimeId ?? "",
    command: entry.command,
    cwd: entry.cwd ?? "",
    comments: existingComments.length > 0 ? existingComments : comments,
    tasks: existingTasks.length > 0 ? existingTasks : tasks,
    messages: existingMessages,
  };
}

function migratedTaskStatus(status: string): AgentTask["status"] {
  switch (status) {
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
    case "running":
    case "draft":
      return "cancelled";
    default:
      return "cancelled";
  }
}
