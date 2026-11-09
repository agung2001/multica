"use client";

import { useEffect, useState } from "react";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { useT } from "../i18n";
import type { LocalBoardAgent } from "./local-board";

export type LocalRunDraft = {
  title: string;
  body: string;
  agentId: string;
  command: string;
  cwd: string;
};

const EMPTY: LocalRunDraft = { title: "", body: "", agentId: "", command: "", cwd: "" };

/**
 * Create form for a local run.
 *
 * Deliberately smaller than the issue dialog: a local item has no status,
 * priority, assignee, labels or project, because none of those exist until it
 * is published. Same shell, same footer, same submit affordances.
 */
export function LocalRunDialog({
  open,
  onOpenChange,
  agents,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: LocalBoardAgent[];
  onCreate: (draft: LocalRunDraft) => void;
}) {
  const { t } = useT("local_runs");
  const [draft, setDraft] = useState<LocalRunDraft>(EMPTY);

  useEffect(() => {
    if (open) setDraft(EMPTY);
  }, [open]);

  const agent = agents.find((entry) => entry.id === draft.agentId) ?? null;
  const canCreate = draft.title.trim().length > 0 && agent !== null;

  const submit = () => {
    if (!canCreate) return;
    onCreate({
      title: draft.title.trim(),
      body: draft.body,
      agentId: draft.agentId,
      // Falling back to the agent's first program keeps Create usable without
      // making the program field mandatory.
      command: draft.command.trim() || agent?.programs[0]?.command || "",
      cwd: draft.cwd.trim(),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(($) => $.create.title)}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label={t(($) => $.create.title_label)}>
            <Input
              autoFocus
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          </Field>

          <Field label={t(($) => $.create.prompt_label)}>
            <Textarea
              rows={4}
              className="resize-y"
              placeholder={t(($) => $.create.prompt_placeholder)}
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t(($) => $.create.agent_label)}>
              <select
                aria-label={t(($) => $.create.agent_label)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-body"
                value={draft.agentId}
                onChange={(event) => {
                  const next = agents.find((entry) => entry.id === event.target.value) ?? null;
                  setDraft({
                    ...draft,
                    agentId: event.target.value,
                    command: next?.programs[0]?.command ?? "",
                  });
                }}
              >
                <option value="">{t(($) => $.create.agent_placeholder)}</option>
                {agents.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t(($) => $.create.folder_label)}>
              <Input
                className="font-mono text-caption"
                placeholder={t(($) => $.create.folder_placeholder)}
                value={draft.cwd}
                onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
              />
            </Field>
          </div>

          <Field label={t(($) => $.create.program_label)}>
            <Input
              className="font-mono text-caption"
              placeholder={agent?.programs[0]?.command ?? ""}
              value={draft.command}
              onChange={(event) => setDraft({ ...draft, command: event.target.value })}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t(($) => $.create.cancel)}
          </Button>
          <Button onClick={submit} disabled={!canCreate}>
            {t(($) => $.create.submit)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-caption text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
