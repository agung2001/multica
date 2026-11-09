"use client";

import type { AgentRuntime } from "../types";

/**
 * A private piece of work that only runs on this machine.
 *
 * Nothing here reaches the server: no issue, no task, no agent runtime change.
 * The board these belong to is local to the device, which is what makes two
 * people able to run the same agent at the same time, and what makes the
 * history disappear when the app's data is cleared.
 */
export type LocalRunStatus = "draft" | "running" | "done" | "failed" | "stopped";

export interface LocalRun {
  id: string;
  title: string;
  body: string;
  /** The agent whose configuration this run borrows. */
  agentId: string | null;
  agentName: string;
  /** Program and arguments to spawn, e.g. `pi -p --mode json`. */
  command: string;
  /** Directory the program runs in. Empty means the user's home directory. */
  cwd: string;
  status: LocalRunStatus;
  output: string;
  createdAt: string;
  updatedAt: string;
  /** Set once the run has been published to the shared board. */
  publishedIssueId: string | null;
}

/**
 * What "run this agent on my machine" means for one agent.
 *
 * This is a preference, not a configuration: it never writes to the agent, so
 * the owner's runtime stays exactly as they left it.
 */
export interface LocalAgentBinding {
  /** The agent CLI on this machine, as registered by the local daemon. */
  runtimeId: string;
  provider: string;
  /** Resolved at bind time from the provider, then editable by the user. */
  command: string;
  /** Optional default directory for runs of this agent. */
  cwd: string;
}

/** Longest transcript kept per run; older output is dropped from the front. */
export const LOCAL_RUN_OUTPUT_LIMIT = 200_000;

/** Most runs kept locally. Drafts are cheap but localStorage is not. */
export const LOCAL_RUN_LIMIT = 100;

/**
 * Default command for an agent CLI, mirroring how the daemon launches it.
 *
 * Only the providers whose non-interactive form is a plain prompt actually get
 * a default; anything else leaves the field empty for the user to fill in,
 * rather than guessing a flag that does not exist.
 */
export function defaultCommandForProvider(provider: string | null): string {
  switch (provider) {
    case "claude":
      return "claude -p --output-format stream-json --verbose";
    case "pi":
      return "pi -p --mode json";
    case "opencode":
      return "opencode run --format json --dangerously-skip-permissions";
    default:
      return "";
  }
}

/** Builds the binding for an agent CLI discovered on this machine. */
export function bindingForRuntime(runtime: AgentRuntime): LocalAgentBinding {
  return {
    runtimeId: runtime.id,
    provider: runtime.provider ?? "",
    command: defaultCommandForProvider(runtime.provider),
    cwd: "",
  };
}
