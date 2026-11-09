"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isLocalIssueId, useLocalIssuesStore } from "@multica/core/local-issues";
import { localRunRunner, splitCommandLine } from "@multica/core/local-runs";
import { agentListOptions } from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { Monitor, Square } from "@multica/ui/icons";
import { useT } from "../../i18n";

/**
 * Run control for an issue that lives only on this machine.
 *
 * The issue is never sent to the server, so no daemon will pick it up: the
 * program runs here, from this window, and its transcript is stored beside the
 * issue. Everything else about the issue behaves normally.
 */
export function LocalIssueRunner({ issueId, wsId }: { issueId: string; wsId: string }) {
  const { t } = useT("issues");
  const record = useLocalIssuesStore((state) =>
    state.issues.find((entry) => entry.issue.id === issueId),
  );
  const setRunStatus = useLocalIssuesStore((state) => state.setRunStatus);
  const appendOutput = useLocalIssuesStore((state) => state.appendOutput);
  const clearOutput = useLocalIssuesStore((state) => state.clearOutput);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const runner = useMemo(() => localRunRunner(), []);
  const [stop, setStop] = useState<(() => void) | null>(null);

  useEffect(() => () => stop?.(), [stop]);

  const run = useCallback(() => {
    if (!record || !runner) return;
    const argv = splitCommandLine(record.command);
    if (argv.length === 0) return;
    const agent = agents.find((entry) => entry.id === record.agentId);
    const prompt = [
      agent?.instructions?.trim(),
      record.issue.title,
      record.issue.description?.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");

    clearOutput(issueId);
    setRunStatus(issueId, "running");
    const handle = runner.start({
      argv,
      cwd: record.cwd,
      prompt,
      onOutput: (chunk) => appendOutput(issueId, chunk),
      onExit: (result) => {
        setStop(null);
        setRunStatus(issueId, result.error || result.code !== 0 ? "failed" : "done");
        if (result.error) appendOutput(issueId, `\n${result.error}\n`);
      },
    });
    setStop(() => handle.stop);
  }, [agents, appendOutput, clearOutput, issueId, record, runner, setRunStatus]);

  if (!isLocalIssueId(issueId) || !record) return null;

  const running = record.runStatus === "running";
  const statusLabel =
    record.runStatus === "draft"
      ? t(($) => $.local_run.idle)
      : record.runStatus === "running"
        ? t(($) => $.local_run.running)
        : record.runStatus === "done"
          ? t(($) => $.local_run.done)
          : record.runStatus === "failed"
            ? t(($) => $.local_run.failed)
            : t(($) => $.local_run.stopped);

  return (
    <section
      aria-label={t(($) => $.local_run.title)}
      className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3"
    >
      <div className="flex items-center gap-2">
        <Monitor className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-caption text-muted-foreground">{t(($) => $.local_run.title)}</span>
        <span className="text-caption text-muted-foreground">·</span>
        <span className="text-caption">{statusLabel}</span>
        <div className="ml-auto">
          {running ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={() => {
                stop?.();
                setStop(null);
                setRunStatus(issueId, "stopped");
              }}
            >
              <Square className="size-3" />
              {t(($) => $.local_run.stop)}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={!runner || record.command.trim().length === 0}
              onClick={run}
            >
              {t(($) => $.local_run.run)}
            </Button>
          )}
        </div>
      </div>
      {record.output ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 font-mono text-caption">
          {record.output}
        </pre>
      ) : null}
    </section>
  );
}
