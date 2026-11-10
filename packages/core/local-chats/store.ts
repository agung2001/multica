"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { defaultStorage } from "../platform/storage";
import type { ChatMessage, TaskMessagePayload } from "../types";

export type LocalChatTaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface LocalChatTask {
  id: string;
  sessionId: string;
  agentId: string;
  status: LocalChatTaskStatus;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
  messages: TaskMessagePayload[];
}

export interface LocalChatSession {
  sessionId: string;
  agentId: string;
  messages: ChatMessage[];
  activeTaskId: string | null;
}

interface LocalChatsState {
  sessions: Record<string, LocalChatSession>;
  tasks: Record<string, LocalChatTask>;
  appendMessage: (sessionId: string, agentId: string, message: ChatMessage) => void;
  createTask: (sessionId: string, agentId: string) => LocalChatTask;
  updateTask: (taskId: string, patch: Partial<LocalChatTask>) => void;
  appendTaskMessage: (
    taskId: string,
    message: Omit<TaskMessagePayload, "task_id" | "issue_id" | "seq" | "created_at"> & {
      created_at?: string;
    },
  ) => void;
}

const EMPTY_TASKS: Record<string, LocalChatTask> = {};
const EMPTY_MESSAGES: TaskMessagePayload[] = [];
const ACTIVE_STATUSES = new Set<LocalChatTaskStatus>(["running"]);

function nowIso(): string {
  return new Date().toISOString();
}

export function isLocalChatTaskId(taskId: string): boolean {
  return taskId.startsWith("local-chat-task-");
}

export const useLocalChatsStore = create<LocalChatsState>()(
  persist(
    (set, get) => ({
      sessions: {},
      tasks: {},
      appendMessage: (sessionId, agentId, message) =>
        set((state) => {
          const current = state.sessions[sessionId];
          const messages = current?.messages ?? [];
          if (messages.some((item) => item.id === message.id)) return state;
          return {
            sessions: {
              ...state.sessions,
              [sessionId]: {
                sessionId,
                agentId: current?.agentId ?? agentId,
                activeTaskId: current?.activeTaskId ?? null,
                messages: [...messages, message].slice(-300),
              },
            },
          };
        }),
      createTask: (sessionId, agentId) => {
        const existing = get().sessions[sessionId];
        const task: LocalChatTask = {
          id: `local-chat-task-${crypto.randomUUID()}`,
          sessionId,
          agentId,
          status: "running",
          createdAt: nowIso(),
          completedAt: null,
          error: null,
          messages: [],
        };
        set((state) => ({
          tasks: { ...state.tasks, [task.id]: task },
          sessions: {
            ...state.sessions,
            [sessionId]: {
              sessionId,
              agentId: existing?.agentId ?? agentId,
              messages: existing?.messages ?? [],
              activeTaskId: task.id,
            },
          },
        }));
        return task;
      },
      updateTask: (taskId, patch) =>
        set((state) => {
          const task = state.tasks[taskId];
          if (!task) return state;
          const next = { ...task, ...patch };
          const session = state.sessions[next.sessionId];
          return {
            tasks: { ...state.tasks, [taskId]: next },
            sessions:
              session && !ACTIVE_STATUSES.has(next.status)
                ? {
                    ...state.sessions,
                    [next.sessionId]: { ...session, activeTaskId: null },
                  }
                : state.sessions,
          };
        }),
      appendTaskMessage: (taskId, message) =>
        set((state) => {
          const task = state.tasks[taskId];
          if (!task) return state;
          const previous = task.messages.at(-1);
          if (
            previous &&
            previous.type === message.type &&
            (message.type === "text" || message.type === "thinking")
          ) {
            return {
              tasks: {
                ...state.tasks,
                [taskId]: {
                  ...task,
                  messages: [
                    ...task.messages.slice(0, -1),
                    {
                      ...previous,
                      content: (previous.content ?? "") + (message.content ?? ""),
                      created_at: message.created_at ?? nowIso(),
                    },
                  ],
                },
              },
            };
          }
          const seq =
            task.messages.reduce((max, item) => Math.max(max, item.seq), 0) + 1;
          return {
            tasks: {
              ...state.tasks,
              [taskId]: {
                ...task,
                messages: [
                  ...task.messages,
                  {
                    ...message,
                    task_id: taskId,
                    issue_id: "",
                    chat_session_id: task.sessionId,
                    seq,
                    created_at: message.created_at ?? nowIso(),
                  },
                ],
              },
            },
          };
        }),
    }),
    {
      name: "multica_local_chats",
      version: 1,
      storage: createJSONStorage(() => defaultStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        tasks: EMPTY_TASKS,
      }),
    },
  ),
);

export function localChatSession(sessionId: string): LocalChatSession | null {
  return useLocalChatsStore.getState().sessions[sessionId] ?? null;
}

export function localChatTask(taskId: string): LocalChatTask | null {
  return useLocalChatsStore.getState().tasks[taskId] ?? null;
}

export function localChatTaskMessages(taskId: string): TaskMessagePayload[] {
  return localChatTask(taskId)?.messages ?? EMPTY_MESSAGES;
}

export function localChatPendingTask(sessionId: string): LocalChatTask | null {
  const session = localChatSession(sessionId);
  if (!session?.activeTaskId) return null;
  const task = localChatTask(session.activeTaskId);
  return task && ACTIVE_STATUSES.has(task.status) ? task : null;
}

export function useLocalChatSession(sessionId: string | null): LocalChatSession | null {
  return useLocalChatsStore((state) =>
    sessionId ? state.sessions[sessionId] ?? null : null,
  );
}

export function useLocalChatActiveTask(sessionId: string | null): LocalChatTask | null {
  return useLocalChatsStore(
    useShallow((state) => {
      if (!sessionId) return null;
      const taskId = state.sessions[sessionId]?.activeTaskId;
      if (!taskId) return null;
      const task = state.tasks[taskId];
      return task && ACTIVE_STATUSES.has(task.status) ? task : null;
    }),
  );
}

export function useLocalChatTaskMessages(taskId: string | null): TaskMessagePayload[] {
  return useLocalChatsStore(
    useShallow((state) => (taskId ? state.tasks[taskId]?.messages ?? EMPTY_MESSAGES : EMPTY_MESSAGES)),
  );
}

export function waitForLocalChatsHydrated(): Promise<void> {
  if (useLocalChatsStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useLocalChatsStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
    if (useLocalChatsStore.persist.hasHydrated()) {
      unsubscribe();
      resolve();
    }
  });
}
