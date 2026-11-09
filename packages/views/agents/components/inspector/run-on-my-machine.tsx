"use client";

import { useMemo } from "react";
import type { Agent, AgentRuntime } from "@multica/core/types";
import {
  isRuntimeUsableForUser,
  providerDisplayName,
  runtimeDisplayName,
} from "@multica/core/runtimes";
import {
  bindingForRuntime,
  useLocalRunsStore,
} from "@multica/core/local-runs";
import { Monitor } from "@multica/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { ProviderLogo } from "../../../runtimes/components/provider-logo";
import { useT } from "../../../i18n";

// Base UI treats "" as "no selection", so "not on this machine" needs a sentinel.
export const NOT_LOCAL = "__not_local__";

type RunOnMyMachineProps = {
  agent: Agent;
  runtimes: AgentRuntime[];
  currentUserId: string | null;
  canEdit: boolean;
  /**
   * daemon_id of the desktop app's own daemon. Only runtimes registered under
   * it count as "this machine" — a person's other machines are deliberately
   * invisible here, because this row answers one question: which agent CLI of
   * this machine should run this agent when I run it myself.
   */
  localDaemonId: string | null;
};

/**
 * "Run on my machine": which agent CLI on this laptop runs this agent.
 *
 * This is a private preference stored on the device. It never writes to the
 * agent — the owner's runtime stays exactly as they configured it — because the
 * server routes every run to the agent's runtime and only the task pipeline can
 * change that. Local runs live on the local board instead.
 */
export function RunOnMyMachine({
  agent,
  runtimes,
  currentUserId,
  canEdit,
  localDaemonId,
}: RunOnMyMachineProps) {
  const { t } = useT("agents");
  const binding = useLocalRunsStore((state) => state.bindings[agent.id] ?? null);
  const bindAgent = useLocalRunsStore((state) => state.bindAgent);
  const unbindAgent = useLocalRunsStore((state) => state.unbindAgent);

  // Agent CLIs installed on this machine. Cloud workers are not local
  // execution, and another member's private runtime is not ours to run.
  const localRuntimes = useMemo(() => {
    if (!localDaemonId) return [];
    return runtimes.filter(
      (runtime) =>
        runtime.daemon_id === localDaemonId &&
        runtime.runtime_mode !== "cloud" &&
        isRuntimeUsableForUser(runtime, currentUserId),
    );
  }, [currentUserId, localDaemonId, runtimes]);

  if (!canEdit || localRuntimes.length === 0) return null;

  const bound = localRuntimes.find((runtime) => runtime.id === binding?.runtimeId) ?? null;
  const offLabel = t(($) => $.inspector.run_on_my_machine_off);

  const choose = (next: string | null) => {
    if (!next) return;
    if (next === NOT_LOCAL) {
      unbindAgent(agent.id);
      return;
    }
    const runtime = localRuntimes.find((entry) => entry.id === next);
    if (runtime) bindAgent(agent.id, bindingForRuntime(runtime));
  };

  const items = [
    { value: NOT_LOCAL, label: offLabel },
    ...localRuntimes.map((runtime) => ({ value: runtime.id, label: agentLabel(runtime) })),
  ];

  return (
    <Select items={items} value={bound?.id ?? NOT_LOCAL} onValueChange={choose}>
      {/* Full width of the control column, like the Runtime picker above it. */}
      <SelectTrigger className="w-full" aria-label={t(($) => $.inspector.run_on_my_machine)}>
        <SelectValue>
          {() => (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {bound ? (
                <ProviderLogo provider={bound.provider} className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Monitor
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {bound ? agentLabel(bound) : offLabel}
              </span>
              {bound ? <StatusDot runtime={bound} /> : null}
            </span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => {
          const runtime = localRuntimes.find((entry) => entry.id === item.value);
          return (
            <SelectItem key={item.value} value={item.value}>
              <span className="flex min-w-0 items-center gap-2">
                {runtime ? (
                  <ProviderLogo provider={runtime.provider} className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Monitor
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 truncate">{item.label}</span>
                {runtime ? <StatusDot runtime={runtime} /> : null}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Online dot, matching the Runtime picker's rows. */
function StatusDot({ runtime }: { runtime: AgentRuntime }) {
  const { t } = useT("agents");
  return (
    <span
      className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${
        runtime.status === "online" ? "bg-success" : "bg-muted-foreground/40"
      }`}
      aria-label={
        runtime.status === "online"
          ? t(($) => $.pickers.runtime_online)
          : t(($) => $.pickers.runtime_offline)
      }
      role="img"
    />
  );
}

/** The agent CLI's own name, which is what a person recognises on their laptop. */
export function agentLabel(runtime: AgentRuntime): string {
  const custom = runtime.custom_name?.trim();
  if (custom) return custom;
  const provider = runtime.provider?.trim();
  if (provider) return providerDisplayName(provider);
  return runtimeDisplayName(runtime);
}
