"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Cloud, Monitor, Server } from "@multica/ui/icons";
import { cn } from "@multica/ui/lib/utils";
import type { Agent } from "@multica/core/types";
import { isAgentRuntimeBound } from "@multica/core/agents";
import { useWorkspaceId } from "@multica/core/hooks";
import { useLocalRunsStore } from "@multica/core/local-runs";
import { runtimeDisplayLabel, runtimeListOptions } from "@multica/core/runtimes";
import { useT } from "../../i18n";

/**
 * Where the open chat's agent will run.
 *
 * A device-local binding wins: it is the choice that matters to this reader,
 * even though it is a private preference rather than the agent's server
 * runtime. Without one, show the runtime the agent is actually bound to.
 */
export function AgentRuntimeIndicator({
  agent,
  className,
}: {
  agent: Agent | null;
  className?: string;
}) {
  const { t } = useT("agents");
  const wsId = useWorkspaceId();
  const { data: runtimes = [] } = useQuery({
    ...runtimeListOptions(wsId),
    enabled: !!agent && !!wsId,
  });
  const localBinding = useLocalRunsStore((state) =>
    agent ? state.bindings[agent.id] ?? null : null,
  );
  if (!agent) return null;

  const runtime = agent.runtime_id
    ? runtimes.find((candidate) => candidate.id === agent.runtime_id) ?? null
    : null;
  const local = localBinding?.command.trim() ? localBinding : null;
  const bound = isAgentRuntimeBound(agent);
  const label = local
    ? t(($) => $.inspector.run_on_my_machine)
    : !bound
      ? t(($) => $.row.needs_runtime)
      : runtime
        ? runtimeDisplayLabel(runtime)
        : null;
  if (!label) return null;

  const Icon = local
    ? Monitor
    : !bound
      ? AlertCircle
      : runtime?.runtime_mode === "cloud"
        ? Cloud
        : Server;

  return (
    <span
      data-agent-runtime-indicator
      data-runtime-target={local ? "local" : runtime ? "runtime" : "unbound"}
      title={label}
      className={cn(
        "inline-flex min-w-0 max-w-40 items-center gap-1.5 rounded-full border px-2 py-1 text-label",
        local
          ? "border-brand/20 bg-brand/7 text-foreground"
          : !bound
            ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            : "border-border bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
