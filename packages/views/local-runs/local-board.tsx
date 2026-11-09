"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  localRunRunner,
  splitCommandLine,
  useLocalRunsStore,
  type LocalRun,
  type LocalRunStatus,
} from "@multica/core/local-runs";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Monitor, Plus, Send, Square, Trash2 } from "@multica/ui/icons";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";
import { LocalRunDialog, type LocalRunDraft } from "./local-run-dialog";

export type LocalBoardAgent = {
  id: string;
  name: string;
  /** The agent's own instructions, prepended to every prompt it runs here. */
  instructions?: string;
  /** Agent CLIs of this machine that could run this agent. */
  programs: { runtimeId: string; label: string; command: string }[];
};

type LocalBoardProps = {
  agents: LocalBoardAgent[];
  /** Hands a finished run to the shared issue dialog, prefilled. */
  onPublish: (run: LocalRun) => void;
  className?: string;
};

/** Column layout, mirroring the issues board's status columns. */
const COLUMNS: { key: string; statuses: LocalRunStatus[] }[] = [
  { key: "drafts", statuses: ["draft", "stopped"] },
  { key: "running", statuses: ["running"] },
  { key: "finished", statuses: ["done", "failed"] },
];

/**
 * The private board: work that exists only on this device.
 *
 * Same shape as the issues board — columns, cards, a detail panel — but the
 * cards come from local storage instead of the server, which is what lets two
 * people run the same agent at the same time.
 */
export function LocalBoard({ agents, onPublish, className }: LocalBoardProps) {
  const { t } = useT("local_runs");
  const runs = useLocalRunsStore((state) => state.runs);
  const create = useLocalRunsStore((state) => state.create);
  const update = useLocalRunsStore((state) => state.update);
  const remove = useLocalRunsStore((state) => state.remove);
  const setStatus = useLocalRunsStore((state) => state.setStatus);
  const appendOutput = useLocalRunsStore((state) => state.appendOutput);
  const clearOutput = useLocalRunsStore((state) => state.clearOutput);

  const statusLabels: Record<LocalRunStatus, string> = useMemo(
    () => ({
      draft: t(($) => $.status.draft),
      running: t(($) => $.status.running),
      done: t(($) => $.status.done),
      failed: t(($) => $.status.failed),
      stopped: t(($) => $.status.stopped),
    }),
    [t],
  );
  const columnLabels: Record<string, string> = useMemo(
    () => ({
      drafts: t(($) => $.columns.drafts),
      running: t(($) => $.columns.running),
      finished: t(($) => $.columns.finished),
    }),
    [t],
  );

  const runner = useMemo(() => localRunRunner(), []);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const detail = runs.find((run) => run.id === detailId) ?? null;

  useEffect(() => () => stopRef.current?.(), []);

  const startRun = (run: LocalRun) => {
    const argv = splitCommandLine(run.command);
    if (!runner || argv.length === 0) return;
    const agent = agents.find((entry) => entry.id === run.agentId) ?? null;
    clearOutput(run.id);
    setStatus(run.id, "running");
    setDetailId(run.id);
    const handle = runner.start({
      argv,
      cwd: run.cwd,
      // The agent's configured instructions travel with the prompt: this run
      // borrows the agent, it does not reimplement it.
      prompt: [agent?.instructions?.trim(), run.body.trim()].filter(Boolean).join("\n\n"),
      onOutput: (chunk) => appendOutput(run.id, chunk),
      onExit: (result) => {
        stopRef.current = null;
        setStatus(run.id, result.error ? "failed" : result.code === 0 ? "done" : "failed");
        if (result.error) appendOutput(run.id, `\n${result.error}\n`);
      },
    });
    stopRef.current = handle.stop;
  };

  const stopRun = (run: LocalRun) => {
    stopRef.current?.();
    stopRef.current = null;
    setStatus(run.id, "stopped");
  };

  const onCreate = (draft: LocalRunDraft) => {
    const agent = agents.find((entry) => entry.id === draft.agentId) ?? null;
    const id = create({
      title: draft.title,
      agentId: draft.agentId,
      agentName: agent?.name ?? "",
      command: draft.command,
    });
    update(id, { body: draft.body, cwd: draft.cwd });
    setDetailId(id);
  };

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <Button variant="outline" className="gap-2" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          {t(($) => $.board.new_run)}
        </Button>
        {!runner ? (
          <p className="text-caption text-muted-foreground">{t(($) => $.board.desktop_only)}</p>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="@container flex min-w-0 flex-1 gap-3 overflow-x-auto">
          {COLUMNS.map((column) => {
            const items = runs.filter((run) => column.statuses.includes(run.status));
            return (
              <section
                key={column.key}
                aria-label={columnLabels[column.key]}
                className="flex min-w-56 flex-1 shrink-0 flex-col rounded-xl bg-muted/40 p-2"
              >
                <header className="mb-2 flex items-center justify-between gap-2 px-1.5">
                  <span className="text-caption font-medium">{columnLabels[column.key]}</span>
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {items.length}
                  </span>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                  {items.map((run) => (
                    <LocalRunCard
                      key={run.id}
                      run={run}
                      selected={run.id === detailId}
                      runnerAvailable={runner !== null}
                      statusLabel={statusLabels[run.status]}
                      onSelect={() => setDetailId(run.id)}
                      onRun={() => startRun(run)}
                      onStop={() => stopRun(run)}
                      onPublish={() => onPublish(run)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {detail ? (
          <aside className="flex w-96 shrink-0 flex-col gap-2 rounded-xl border border-border p-3">
            <Input
              aria-label={t(($) => $.board.title_label)}
              placeholder={t(($) => $.board.title_placeholder)}
              value={detail.title}
              onChange={(event) => update(detail.id, { title: event.target.value })}
            />
            <div className="flex gap-2">
              <select
                aria-label={t(($) => $.board.agent_label)}
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-body"
                value={detail.agentId ?? ""}
                onChange={(event) => {
                  const agent = agents.find((entry) => entry.id === event.target.value) ?? null;
                  update(detail.id, {
                    agentId: agent?.id ?? null,
                    agentName: agent?.name ?? "",
                    command: detail.command.trim()
                      ? detail.command
                      : (agent?.programs[0]?.command ?? ""),
                  });
                }}
              >
                <option value="">{t(($) => $.board.agent_placeholder)}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              <Button
                variant="ghost"
                aria-label={t(($) => $.board.remove)}
                onClick={() => {
                  remove(detail.id);
                  setDetailId(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <Input
              aria-label={t(($) => $.board.command_label)}
              className="font-mono text-caption"
              value={detail.command}
              onChange={(event) => update(detail.id, { command: event.target.value })}
            />
            <Input
              aria-label={t(($) => $.board.cwd_label)}
              className="font-mono text-caption"
              placeholder={t(($) => $.board.cwd_placeholder)}
              value={detail.cwd}
              onChange={(event) => update(detail.id, { cwd: event.target.value })}
            />
            <Textarea
              aria-label={t(($) => $.board.body_label)}
              className="min-h-24 resize-y"
              rows={5}
              placeholder={t(($) => $.board.body_placeholder)}
              value={detail.body}
              onChange={(event) => update(detail.id, { body: event.target.value })}
            />
            <pre
              aria-label={t(($) => $.board.output_label)}
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 font-mono text-caption"
            >
              {detail.output || t(($) => $.board.output_empty)}
            </pre>
          </aside>
        ) : null}
      </div>

      <LocalRunDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agents={agents}
        onCreate={onCreate}
      />
    </div>
  );
}

function LocalRunCard({
  run,
  selected,
  runnerAvailable,
  statusLabel,
  onSelect,
  onRun,
  onStop,
  onPublish,
}: {
  run: LocalRun;
  selected: boolean;
  runnerAvailable: boolean;
  statusLabel: string;
  onSelect: () => void;
  onRun: () => void;
  onStop: () => void;
  onPublish: () => void;
}) {
  const { t } = useT("local_runs");
  const running = run.status === "running";
  const canRun = runnerAvailable && !running && splitCommandLine(run.command).length > 0;

  return (
    <article
      className={cn(
        "group/card flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-left shadow-sm transition-colors",
        selected ? "border-brand/60 ring-1 ring-brand/30" : "hover:border-border/80 hover:bg-accent/40",
      )}
    >
      <button type="button" onClick={onSelect} className="flex flex-col gap-1 text-left">
        <span className="line-clamp-2 text-body font-medium">
          {run.title || t(($) => $.board.untitled)}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <Monitor className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{run.agentName || t(($) => $.board.no_agent)}</span>
          <span aria-hidden="true">·</span>
          <span
            className={cn(
              "truncate",
              run.status === "failed" && "text-destructive",
              run.status === "running" && "text-success",
            )}
          >
            {statusLabel}
          </span>
        </span>
      </button>

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100">
        {running ? (
          <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-caption" onClick={onStop}>
            <Square className="h-3 w-3" />
            {t(($) => $.board.stop)}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-6 gap-1 px-2 text-caption"
            disabled={!canRun}
            onClick={onRun}
          >
            {t(($) => $.board.run)}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-caption"
          disabled={running || !run.body.trim()}
          onClick={onPublish}
        >
          <Send className="h-3 w-3" />
          {run.publishedAt ? t(($) => $.board.published) : t(($) => $.board.publish)}
        </Button>
      </div>
    </article>
  );
}
