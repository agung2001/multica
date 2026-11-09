"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core";
import { defaultCommandForProvider } from "@multica/core/local-runs";
import type { LocalRun } from "@multica/core/local-runs";
import { agentListOptions } from "@multica/core/workspace/queries";
import { runtimeListOptions } from "@multica/core/runtimes/queries";
import { useCreateIssue } from "@multica/core/issues/mutations";
import { useLocalDaemonStatus } from "../platform/use-local-daemon-status";
import { useT } from "../i18n";
import { LocalBoard, type LocalBoardAgent } from "./local-board";

/**
 * Host page for the private board: supplies the agents that can run here, the
 * programs this machine has for them, and the publish path back to the shared
 * board.
 *
 * Everything the board stores stays on the device; the only server call in this
 * file is `onPublish`, and it happens when a person asks for it.
 */
export function LocalRunsPage() {
  const { t } = useT("local_runs");
  const wsId = useWorkspaceId();
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  const { daemonId } = useLocalDaemonStatus();
  const createIssue = useCreateIssue();

  // Only CLIs registered by this machine's daemon can be run here. Other
  // machines of the same person are irrelevant: this board runs things locally
  // or not at all.
  const programs = useMemo(
    () =>
      runtimes
        .filter((runtime) => daemonId !== null && runtime.daemon_id === daemonId)
        .map((runtime) => ({
          runtimeId: runtime.id,
          label: runtime.custom_name?.trim() || runtime.provider || runtime.name,
          command: defaultCommandForProvider(runtime.provider),
        })),
    [daemonId, runtimes],
  );

  const boardAgents = useMemo<LocalBoardAgent[]>(
    () =>
      agents
        .filter((agent) => !agent.archived_at)
        .map((agent) => ({
          id: agent.id,
          name: agent.name,
          instructions: agent.instructions ?? "",
          programs,
        })),
    [agents, programs],
  );

  const onPublish = useCallback(
    async (run: LocalRun) => {
      const title = run.title.trim() || firstLine(run.body) || t(($) => $.board.untitled);
      const description = [
        run.body.trim(),
        run.output.trim() ? "```\n" + run.output.trim() + "\n```" : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const issue = await createIssue.mutateAsync({ title, description });
      return issue?.id ?? null;
    },
    [createIssue, t],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading-lg font-semibold">{t(($) => $.page.title)}</h1>
        <p className="text-caption text-muted-foreground">{t(($) => $.page.description)}</p>
      </header>
      <LocalBoard agents={boardAgents} onPublish={onPublish} />
    </div>
  );
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}
