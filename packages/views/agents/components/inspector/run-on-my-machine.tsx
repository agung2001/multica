"use client";

import { useMemo } from "react";
import type { Agent, AgentRuntime } from "@multica/core/types";
import {
  isRuntimeUsableForUser,
  providerDisplayName,
  runtimeDisplayName,
} from "@multica/core/runtimes";
import { useAgentOwnerRuntimeStore } from "@multica/core/agents";
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

// Base UI treats "" as "no selection", so the owner's default needs a sentinel.
export const OWNER_DEFAULT = "__owner_default__";

type RunOnMyMachineProps = {
  agent: Agent;
  runtimes: AgentRuntime[];
  currentUserId: string | null;
  canEdit: boolean;
  /**
   * daemon_id of the desktop app's own daemon. Only runtimes registered under
   * it count as "this machine" — a person's other machines are deliberately
   * invisible here, because this row answers one question: run it here, or
   * leave it to the owner.
   */
  localDaemonId: string | null;
  /** Binds the agent. Clearing defaults lives in useExecutionControls. */
  onBind: (runtimeId: string) => void;
};

/**
 * "Run on my machine": execute this agent locally, or leave it to the owner.
 *
 * An agent has a single runtime, so both choices write the same `runtime_id`
 * the Runtime row above shows. This row exists to name the two intentions —
 * *here, on an agent CLI I have installed* versus *whatever the owner set up* —
 * instead of making people map "Pi · ubuntu" back to whose machine that is.
 */
export function RunOnMyMachine({
  agent,
  runtimes,
  currentUserId,
  canEdit,
  localDaemonId,
  onBind,
}: RunOnMyMachineProps) {
  const { t } = useT("agents");
  const rememberedOwnerRuntimeId = useAgentOwnerRuntimeStore(
    (state) => state.entries[agent.id] ?? null,
  );
  const rememberOwnerRuntime = useAgentOwnerRuntimeStore((state) => state.remember);

  // Agents installed on this machine. Excludes cloud workers (they are not
  // local execution) and anything the server would refuse to bind.
  const localRuntimes = useMemo(() => {
    if (!localDaemonId) return [];
    return runtimes.filter(
      (runtime) =>
        runtime.daemon_id === localDaemonId &&
        runtime.runtime_mode !== "cloud" &&
        isRuntimeUsableForUser(runtime, currentUserId),
    );
  }, [currentUserId, localDaemonId, runtimes]);

  // Where "leave it to the owner" goes back to: the binding this device
  // replaced when we still know it, otherwise the owner's best runtime. The
  // remembered value is what keeps a machine with several agent CLIs from
  // silently switching CLI on the way back.
  const ownerRuntime = useMemo(
    () => resolveOwnerRuntime(agent, runtimes, currentUserId, rememberedOwnerRuntimeId),
    [agent, currentUserId, rememberedOwnerRuntimeId, runtimes],
  );

  if (!canEdit || localRuntimes.length === 0) return null;

  const boundLocally = localRuntimes.find((runtime) => runtime.id === agent.runtime_id) ?? null;
  const value = boundLocally ? boundLocally.id : OWNER_DEFAULT;
  const defaultLabel = t(($) => $.inspector.run_on_owner_default);

  const select = (next: string | null) => {
    if (!next || next === value) return;
    if (next === OWNER_DEFAULT) {
      // Nothing to restore to means the option should not have been offered;
      // keep the current binding rather than clearing it.
      if (ownerRuntime) onBind(ownerRuntime.id);
      return;
    }
    // Remember what we are about to overwrite, but only while it is still the
    // owner's binding — that is the value "Default" is supposed to restore.
    const current = runtimes.find((runtime) => runtime.id === agent.runtime_id);
    if (current && current.owner_id === agent.owner_id) {
      rememberOwnerRuntime(agent.id, current.id);
    }
    onBind(next);
  };

  const items = [
    { value: OWNER_DEFAULT, label: defaultLabel },
    ...localRuntimes.map((runtime) => ({ value: runtime.id, label: agentLabel(runtime) })),
  ];

  return (
    <Select
      items={items}
      value={value}
      onValueChange={select}
    >
      {/* Full width of the control column, like the Runtime picker above it:
          the trigger defaults to w-fit, which made this row look like a chip. */}
      <SelectTrigger className="w-full" aria-label={t(($) => $.inspector.run_on_my_machine)}>
        <SelectValue>
          {() => (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              {boundLocally ? (
                <ProviderLogo
                  provider={boundLocally.provider}
                  className="h-3.5 w-3.5 shrink-0"
                />
              ) : (
                <Monitor
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {boundLocally ? agentLabel(boundLocally) : defaultLabel}
              </span>
              {boundLocally ? <StatusDot runtime={boundLocally} /> : null}
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

/**
 * The runtime the Runtime row should display while this device overrides the
 * agent, or null when no override is active.
 *
 * Moving an agent to this laptop writes the same `runtime_id` the Runtime row
 * reads, which would otherwise erase every trace of what the owner configured.
 * While the override is active the row keeps showing the owner's runtime
 * (remembered, see useAgentOwnerRuntimeStore) and the "Run on my machine" row
 * shows where the work actually runs, so the two rows answer two different
 * questions instead of echoing each other.
 */
export function ownerConfiguredRuntimeId(
  agent: Agent,
  runtimes: AgentRuntime[],
  localDaemonId: string | null,
  rememberedRuntimeId: string | null,
): string | null {
  if (!localDaemonId || !rememberedRuntimeId) return null;
  const effective = runtimes.find((runtime) => runtime.id === agent.runtime_id);
  if (!effective || effective.daemon_id !== localDaemonId) return null;
  const remembered = runtimes.find((runtime) => runtime.id === rememberedRuntimeId);
  if (!remembered || remembered.owner_id !== agent.owner_id) return null;
  return remembered.id;
}

/** The agent CLI's own name, which is what a person recognises on their laptop. */
function agentLabel(runtime: AgentRuntime): string {
  const custom = runtime.custom_name?.trim();
  if (custom) return custom;
  const provider = runtime.provider?.trim();
  if (provider) return providerDisplayName(provider);
  return runtimeDisplayName(runtime);
}

/**
 * Where "Default (owner's machine)" points.
 *
 * The remembered binding wins — it is the runtime the agent actually had before
 * this device changed it. Only when there is nothing to remember (first visit,
 * a different machine, or an entry that no longer qualifies) does it fall back
 * to picking one of the owner's runtimes, which cannot know which agent CLI of
 * theirs the agent was on.
 */
export function resolveOwnerRuntime(
  agent: Agent,
  runtimes: AgentRuntime[],
  currentUserId: string | null,
  rememberedRuntimeId: string | null,
): AgentRuntime | null {
  const ownerId = agent.owner_id;
  if (!ownerId) return null;

  if (rememberedRuntimeId) {
    const remembered = runtimes.find((runtime) => runtime.id === rememberedRuntimeId);
    if (
      remembered &&
      remembered.owner_id === ownerId &&
      isRuntimeUsableForUser(remembered, currentUserId)
    ) {
      return remembered;
    }
  }
  return ownerDefaultRuntime(agent, runtimes, currentUserId);
}

/**
 * Fallback owner runtime: prefer an online one, then the most recently active.
 *
 * Only used when there is no remembered binding, so the arbitrary-looking
 * ordering never overrides a known answer.
 */
export function ownerDefaultRuntime(
  agent: Agent,
  runtimes: AgentRuntime[],
  currentUserId: string | null,
): AgentRuntime | null {
  const ownerId = agent.owner_id;
  if (!ownerId) return null;
  const owned = runtimes.filter(
    (runtime) =>
      runtime.owner_id === ownerId && isRuntimeUsableForUser(runtime, currentUserId),
  );
  if (owned.length === 0) return null;
  return [...owned].sort(compareByActivity)[0] ?? null;
}

function activityOf(runtime: AgentRuntime): number {
  const stamp = runtime.last_seen_at ?? runtime.updated_at ?? runtime.created_at;
  const parsed = Date.parse(stamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareByActivity(left: AgentRuntime, right: AgentRuntime): number {
  const onlineDelta =
    Number(right.status === "online") - Number(left.status === "online");
  if (onlineDelta !== 0) return onlineDelta;
  return activityOf(right) - activityOf(left);
}
