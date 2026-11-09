"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  activeLocalTurn,
  isLocalIssueId,
  useLocalIssuesStore,
  type LocalIssueTurn,
} from "@multica/core/local-issues";
import { startLocalIssueRun, stopLocalIssueRun } from "@multica/core/local-issues";
import { agentListOptions } from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { Monitor, Square } from "@multica/ui/icons";
import { cn } from "@multica/ui/lib/utils";
import { ActorAvatar } from "../../common/actor-avatar";
import { useT } from "../../i18n";
import { TaskStatusIcon } from "./task-status-icon";

const EMPTY_TURNS: LocalIssueTurn[] = [];

/**
 * The execution feed for an issue that only exists on this machine.
 *
 * It stands where the comment timeline stands for a server issue: what was
 * asked, what the agent did, and the box to answer it — so a local run is read
 * and steered in the same place and the same shape as any other run.
 */
export function LocalIssueFeed({ issueId }: { issueId: string }) {
  const { t } = useT("issues");
  const record = useLocalIssuesStore((state) =>
    state.issues.find((entry) => entry.issue.id === issueId),
  );
  const wsId = record?.issue.workspace_id ?? "";
  const { data: agents = [] } = useQuery({ ...agentListOptions(wsId), enabled: !!wsId });
  const agent = agents.find((entry) => entry.id === record?.agentId) ?? null;
  const turns = record?.turns ?? EMPTY_TURNS;
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastTurn = turns[turns.length - 1];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, lastTurn?.output.length]);

  if (!isLocalIssueId(issueId) || !record) return null;

  return (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Monitor className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-caption text-muted-foreground">{t(($) => $.local_run.title)}</span>
      </div>

      {turns.length === 0 ? (
        <p className="text-caption text-muted-foreground">{t(($) => $.local_run.idle)}</p>
      ) : null}

      {turns.map((turn) => (
        <div key={turn.id} className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 w-6 shrink-0 text-right text-caption text-muted-foreground">
              {t(($) => $.local_run.you)}
            </span>
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-body text-muted-foreground">
              {turn.prompt}
            </p>
          </div>

          <div className="flex items-start gap-2">
            <ActorAvatar
              actorType="agent"
              actorId={record.agentId}
              name={agent?.name ?? ""}
              size="sm"
              className="mt-0.5 shrink-0"
            />
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/30 p-2.5">
              <div className="flex items-center gap-2">
                <TaskStatusIcon status={turnStatus(turn.status) ?? "queued"} />
                <span className="truncate text-caption font-medium">
                  {agent?.name ?? t(($) => $.local_run.agent_fallback)}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-caption",
                      turn.status === "failed" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {t(($) => $.local_run[turn.status])}
                  </span>
                  {turn.status === "running" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-1.5 text-caption"
                      onClick={() => stopLocalIssueRun(issueId)}
                    >
                      <Square className="size-3" />
                      {t(($) => $.local_run.stop)}
                    </Button>
                  ) : null}
                </span>
              </div>
              {turn.error ? (
                <p className="mt-1.5 text-caption text-destructive">{turn.error}</p>
              ) : null}
              {turn.output ? (
                <pre className="mt-1.5 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-caption">
                  {turn.output}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  );
}

/** The reply box, standing where the comment composer stands. */
export function LocalIssueComposer({ issueId }: { issueId: string }) {
  const { t } = useT("issues");
  const [text, setText] = useState("");
  const record = useLocalIssuesStore((state) =>
    state.issues.find((entry) => entry.issue.id === issueId),
  );
  const running = activeLocalTurn(record ?? null) !== null;

  if (!isLocalIssueId(issueId)) return null;

  const send = () => {
    const feedback = text.trim();
    if (!feedback || running) return;
    if (startLocalIssueRun(issueId, feedback)) setText("");
  };

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      <textarea
        aria-label={t(($) => $.local_run.reply_placeholder)}
        placeholder={t(($) => $.local_run.reply_placeholder)}
        className="max-h-40 min-h-16 w-full resize-y bg-transparent px-1.5 py-1 text-body outline-none"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-caption text-muted-foreground">
          {running ? t(($) => $.local_run.running) : t(($) => $.local_run.hint)}
        </span>
        <Button size="sm" className="h-7" disabled={running || !text.trim()} onClick={send}>
          {t(($) => $.local_run.send)}
        </Button>
      </div>
    </div>
  );
}

function turnStatus(status: LocalIssueTurn["status"]): "completed" | "failed" | "cancelled" | null {
  if (status === "done") return "completed";
  if (status === "failed") return "failed";
  if (status === "stopped") return "cancelled";
  return null;
}
