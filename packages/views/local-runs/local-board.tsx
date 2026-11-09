"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  localRunRunner,
  splitCommandLine,
  useLocalRunsStore,
  type LocalRun,
} from "@multica/core/local-runs";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { Plus, Trash2 } from "@multica/ui/icons";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";

export type LocalBoardAgent = {
  id: string;
  name: string;
  /** Agent CLIs of this machine that could run this agent. */
  programs: { runtimeId: string; label: string; command: string }[];
};

type LocalBoardProps = {
  agents: LocalBoardAgent[];
  /** Creates a shared issue out of a finished run. Resolves to the issue id. */
  onPublish: (run: LocalRun) => Promise<string | null>;
  className?: string;
};

/**
 * The private board: work that exists only on this device.
 *
 * Nothing here reaches the server until someone publishes a run, which is what
 * lets two people run the same agent at the same time — and what makes this
 * history disappear when the app's data is cleared.
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
  const bindings = useLocalRunsStore((state) => state.bindings);

  const statusLabels: Record<LocalRun["status"], string> = useMemo(
    () => ({
      draft: t(($) => $.status.draft),
      running: t(($) => $.status.running),
      done: t(($) => $.status.done),
      failed: t(($) => $.status.failed),
      stopped: t(($) => $.status.stopped),
    }),
    [t],
  );

  const runner = useMemo(() => localRunRunner(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const [publishing, setPublishing] = useState(false);

  const selected = runs.find((run) => run.id === selectedId) ?? runs[0] ?? null;
  const argv = selected ? splitCommandLine(selected.command) : [];
  const canRun =
    runner !== null &&
    selected !== null &&
    argv.length > 0 &&
    selected.agentId !== null &&
    selected.status !== "running";

  useEffect(() => () => stopRef.current?.(), []);

  const startRun = () => {
    if (!runner || !selected || argv.length === 0) return;
    const runId = selected.id;
    clearOutput(runId);
    setStatus(runId, "running");
    const handle = runner.start({
      argv,
      cwd: selected.cwd,
      prompt: selected.body,
      onOutput: (chunk) => appendOutput(runId, chunk),
      onExit: (result) => {
        stopRef.current = null;
        setStatus(runId, result.error ? "failed" : result.code === 0 ? "done" : "failed");
        if (result.error) appendOutput(runId, `\n${result.error}\n`);
      },
    });
    stopRef.current = handle.stop;
  };

  const stopRun = () => {
    stopRef.current?.();
    stopRef.current = null;
    if (selected) setStatus(selected.id, "stopped");
  };

  const publish = async () => {
    if (!selected) return;
    setPublishing(true);
    try {
      const issueId = await onPublish(selected);
      if (issueId) {
        update(selected.id, { publishedIssueId: issueId });
        setStatus(selected.id, "done");
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className={cn("@container flex min-h-0 flex-1 gap-4", className)}>
      <aside className="flex w-64 shrink-0 flex-col gap-2">
        <Button
          variant="outline"
          className="justify-start gap-2"
          onClick={() => setSelectedId(create({ title: "" }))}
        >
          <Plus className="h-4 w-4" />
          {t(($) => $.board.new_run)}
        </Button>
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {runs.length === 0 ? (
            <li className="px-2 py-6 text-caption text-muted-foreground">
              {t(($) => $.board.empty)}
            </li>
          ) : null}
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => setSelectedId(run.id)}
                className={cn(
                  "flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent",
                  run.id === selected?.id && "bg-accent",
                )}
              >
                <span className="truncate text-body">{run.title || t(($) => $.board.untitled)}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {statusLabels[run.status]}
                  {run.agentName ? ` · ${run.agentName}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col gap-3">
        {!runner ? (
          <p className="rounded-md border border-dashed border-border px-3 py-2 text-caption text-muted-foreground">
            {t(($) => $.board.desktop_only)}
          </p>
        ) : null}

        {selected ? (
          <>
            <Input
              aria-label={t(($) => $.board.title_label)}
              placeholder={t(($) => $.board.title_placeholder)}
              value={selected.title}
              onChange={(event) => update(selected.id, { title: event.target.value })}
            />

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t(($) => $.board.agent_label)}
                className="h-9 min-w-40 rounded-md border border-input bg-transparent px-2 text-body"
                value={selected.agentId ?? ""}
                onChange={(event) => {
                  const agent = agents.find((entry) => entry.id === event.target.value) ?? null;
                  update(selected.id, {
                    agentId: agent?.id ?? null,
                    agentName: agent?.name ?? "",
                    command: agent ? commandFor(agent, bindings, selected.command) : "",
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

              <Input
                aria-label={t(($) => $.board.command_label)}
                className="min-w-64 flex-1 font-mono text-caption"
                value={selected.command}
                onChange={(event) => update(selected.id, { command: event.target.value })}
              />
              <Input
                aria-label={t(($) => $.board.cwd_label)}
                className="min-w-48 flex-1 font-mono text-caption"
                placeholder={t(($) => $.board.cwd_placeholder)}
                value={selected.cwd}
                onChange={(event) => update(selected.id, { cwd: event.target.value })}
              />
            </div>

            <Textarea
              aria-label={t(($) => $.board.body_label)}
              className="min-h-28 resize-y"
              rows={5}
              placeholder={t(($) => $.board.body_placeholder)}
              value={selected.body}
              onChange={(event) => update(selected.id, { body: event.target.value })}
            />

            <div className="flex items-center gap-2">
              {selected.status === "running" ? (
                <Button variant="outline" onClick={stopRun}>
                  {t(($) => $.board.stop)}
                </Button>
              ) : (
                <Button onClick={startRun} disabled={!canRun}>
                  {t(($) => $.board.run)}
                </Button>
              )}
              <Button
                variant="outline"
                onClick={publish}
                disabled={publishing || selected.status === "running" || !selected.body.trim()}
              >
                {selected.publishedIssueId
                  ? t(($) => $.board.published)
                  : t(($) => $.board.publish)}
              </Button>
              <span className="ml-auto flex items-center gap-2 text-caption text-muted-foreground">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    selected.status === "running"
                      ? "bg-success"
                      : selected.status === "failed"
                        ? "bg-destructive"
                        : "bg-muted-foreground/40",
                  )}
                  aria-hidden="true"
                />
                {statusLabels[selected.status]}
              </span>
              <Button
                variant="ghost"
                aria-label={t(($) => $.board.remove)}
                onClick={() => {
                  remove(selected.id);
                  setSelectedId(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <pre
              aria-label={t(($) => $.board.output_label)}
              className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-caption"
            >
              {selected.output || t(($) => $.board.output_empty)}
            </pre>
          </>
        ) : (
          <p className="px-2 py-6 text-caption text-muted-foreground">
            {t(($) => $.board.select_hint)}
          </p>
        )}
      </section>
    </div>
  );
}

function commandFor(
  agent: LocalBoardAgent,
  bindings: Record<string, { command: string }>,
  current: string,
): string {
  // A run keeps whatever it was using: only fill in a default when the field is
  // still empty, so switching agents never overwrites a tuned command line.
  if (current.trim()) return current;
  return bindings[agent.id]?.command ?? agent.programs[0]?.command ?? "";
}

