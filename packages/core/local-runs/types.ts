"use client";

import type { AgentRuntime } from "../types";

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
