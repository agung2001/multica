// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocalRunsStore, type LocalRun } from "@multica/core/local-runs";
import { renderWithI18n } from "../test/i18n";
import { LocalBoard, type LocalBoardAgent } from "./local-board";

const agents: LocalBoardAgent[] = [
  {
    id: "agent-1",
    name: "Reviewer",
    instructions: "You are the reviewer.",
    programs: [{ runtimeId: "rt-pi", label: "Pi", command: "pi -p --mode json" }],
  },
];

/** Minimal stand-in for the preload bridge the desktop app exposes. */
function installRunner() {
  const listeners = { output: [] as ((id: string, chunk: string) => void)[], exit: [] as ((id: string, result: { code: number | null; error?: string }) => void)[] };
  const api = {
    start: vi.fn(async (_input: { argv: string[]; cwd: string; prompt: string }) => ({
      runId: "r1",
    })),
    stop: vi.fn(),
    onOutput: (cb: (id: string, chunk: string) => void) => {
      listeners.output.push(cb);
      return () => listeners.output.splice(listeners.output.indexOf(cb), 1);
    },
    onExit: (cb: (id: string, result: { code: number | null; error?: string }) => void) => {
      listeners.exit.push(cb);
      return () => listeners.exit.splice(listeners.exit.indexOf(cb), 1);
    },
  };
  (window as unknown as { localRunAPI: typeof api }).localRunAPI = api;
  return {
    api,
    emitOutput: (chunk: string) => listeners.output.forEach((cb) => cb("r1", chunk)),
    emitExit: (code: number | null, error?: string) =>
      listeners.exit.forEach((cb) => cb("r1", { code, error })),
  };
}

function run(overrides: Partial<LocalRun> = {}): LocalRun {
  return {
    id: "run-1",
    title: "Check the importer",
    body: "Explain the import flow",
    agentId: "agent-1",
    agentName: "Reviewer",
    command: "pi -p --mode json",
    cwd: "/tmp",
    status: "draft",
    output: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    publishedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  useLocalRunsStore.setState({ runs: [], bindings: {} });
  delete (window as unknown as { localRunAPI?: unknown }).localRunAPI;
});

describe("LocalBoard", () => {
  it("says so when the platform cannot run programs", () => {
    useLocalRunsStore.setState({ runs: [run()] });

    renderWithI18n(<LocalBoard agents={agents} onPublish={async () => null} />);

    expect(screen.getByText(/Local runs need the desktop app/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
  });

  it("streams output into the selected run and records the exit", async () => {
    const runner = installRunner();
    useLocalRunsStore.setState({ runs: [run()] });
    const user = userEvent.setup();

    renderWithI18n(<LocalBoard agents={agents} onPublish={async () => null} />);
    await user.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => expect(runner.api.start).toHaveBeenCalled());
    const started = runner.api.start.mock.calls[0]?.[0];
    expect(started).toMatchObject({
      argv: ["pi", "-p", "--mode", "json"],
      cwd: "/tmp",
      prompt: "You are the reviewer.\n\nExplain the import flow",
    });
    expect(useLocalRunsStore.getState().runs[0]?.status).toBe("running");

    runner.emitOutput("working…");
    await waitFor(() => expect(useLocalRunsStore.getState().runs[0]?.output).toBe("working…"));

    runner.emitExit(0);
    await waitFor(() => expect(useLocalRunsStore.getState().runs[0]?.status).toBe("done"));
  });

  it("marks a run that could not start as failed and keeps the reason", async () => {
    const runner = installRunner();
    useLocalRunsStore.setState({ runs: [run()] });
    const user = userEvent.setup();

    renderWithI18n(<LocalBoard agents={agents} onPublish={async () => null} />);
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(runner.api.start).toHaveBeenCalled());

    runner.emitExit(null, "spawn pi ENOENT");

    await waitFor(() => expect(useLocalRunsStore.getState().runs[0]?.status).toBe("failed"));
    expect(useLocalRunsStore.getState().runs[0]?.output).toContain("spawn pi ENOENT");
  });

  it("hands a finished run to the host for publishing", async () => {
    const onPublish = vi.fn();
    useLocalRunsStore.setState({ runs: [run()] });
    const user = userEvent.setup();

    renderWithI18n(<LocalBoard agents={agents} onPublish={onPublish} />);
    await user.click(screen.getByRole("button", { name: "Publish to board" }));

    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ id: "run-1" }));
  });

  it("creates a run from the dialog and keeps it in the drafts column", async () => {
    const user = userEvent.setup();
    renderWithI18n(<LocalBoard agents={agents} onPublish={() => {}} />);

    await user.click(screen.getByRole("button", { name: "New run" }));
    await user.type(screen.getByLabelText("Title"), "Wire the importer");
    await user.selectOptions(screen.getByLabelText("Agent"), "agent-1");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const created = useLocalRunsStore.getState().runs[0];
    expect(created).toMatchObject({ title: "Wire the importer", agentId: "agent-1", status: "draft" });
    // The command comes from the agent's program when the field is left empty.
    expect(created?.command).toBe("pi -p --mode json");
  });
});
