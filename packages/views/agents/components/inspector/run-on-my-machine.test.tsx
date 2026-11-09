// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { useLocalRunsStore } from "@multica/core/local-runs";
import { renderWithI18n } from "../../../test/i18n";
import { NOT_LOCAL, RunOnMyMachine, agentLabel } from "./run-on-my-machine";

const THIS_DAEMON = "daemon-this";
const OTHER_DAEMON = "daemon-other";

function runtime(
  id: string,
  ownerId: string | null,
  overrides: Partial<AgentRuntime> = {},
): AgentRuntime {
  return {
    id,
    workspace_id: "workspace-1",
    daemon_id: THIS_DAEMON,
    name: id,
    runtime_mode: "local",
    provider: "claude",
    launch_header: "",
    status: "online",
    device_info: "this-mac · macOS (arm64)",
    metadata: {},
    owner_id: ownerId,
    visibility: "public",
    last_seen_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } satisfies AgentRuntime;
}

function agentOn(runtimeId: string, ownerId = "user-me"): Agent {
  return {
    id: "agent-1",
    workspace_id: "workspace-1",
    name: "Reviewer",
    runtime_id: runtimeId,
    owner_id: ownerId,
  } as Agent;
}

// The owner's machine lives on another daemon, so it is never offered here.
const ownerRuntime = runtime("claude (owner-box)", "user-me", { daemon_id: OTHER_DAEMON });
const localClaude = runtime("claude (this-mac)", "user-me", { provider: "claude" });
const localPi = runtime("pi (this-mac)", "user-me", { provider: "pi" });
const myOtherMachine = runtime("claude (second-mac)", "user-me", { daemon_id: OTHER_DAEMON });

const ALL = [ownerRuntime, localClaude, localPi, myOtherMachine];

function render(props: Partial<React.ComponentProps<typeof RunOnMyMachine>> = {}) {
  renderWithI18n(
    <RunOnMyMachine
      agent={agentOn(ownerRuntime.id)}
      runtimes={ALL}
      currentUserId="user-me"
      canEdit
      localDaemonId={THIS_DAEMON}
      {...props}
    />,
  );
}

async function openSelect() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Run on my machine" }));
  return user;
}

afterEach(() => {
  cleanup();
  useLocalRunsStore.setState({ bindings: {} });
});

describe("RunOnMyMachine", () => {
  it("offers only the agent CLIs installed on this machine", async () => {
    render();
    await openSelect();

    expect(await screen.findByRole("option", { name: /Not on this machine/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Pi/ })).toBeTruthy();
    // Exactly one Claude: the same person's second machine is not this machine.
    expect(screen.getAllByRole("option", { name: /Claude/ })).toHaveLength(1);
  });

  it("records the choice locally and never touches the agent", async () => {
    render();
    const user = await openSelect();

    await user.click(await screen.findByRole("option", { name: /Pi/ }));

    // The preference is a device-local binding: no runtime change is sent.
    expect(useLocalRunsStore.getState().bindings["agent-1"]).toMatchObject({
      runtimeId: localPi.id,
      provider: "pi",
      command: "pi -p --mode json",
    });
  });

  it("shows the bound program as the current value", () => {
    useLocalRunsStore.getState().bindAgent("agent-1", {
      runtimeId: localPi.id,
      provider: "pi",
      command: "pi -p --mode json",
      cwd: "",
    });
    render();

    expect(
      screen.getByRole("combobox", { name: "Run on my machine" }).textContent,
    ).toContain("Pi");
  });

  it("clears the preference from the off option", async () => {
    useLocalRunsStore.getState().bindAgent("agent-1", {
      runtimeId: localPi.id,
      provider: "pi",
      command: "pi",
      cwd: "",
    });
    render();
    const user = await openSelect();

    await user.click(await screen.findByRole("option", { name: /Not on this machine/ }));

    expect(useLocalRunsStore.getState().bindings["agent-1"]).toBeUndefined();
  });

  it("marks whether the local CLI is online", async () => {
    useLocalRunsStore.getState().bindAgent("agent-1", {
      runtimeId: localPi.id,
      provider: "pi",
      command: "pi",
      cwd: "",
    });
    render({ runtimes: [localPi, { ...localClaude, status: "offline" }] });
    await openSelect();

    // One dot per row plus one in the trigger, so a plain count is the check.
    expect(await screen.findAllByLabelText(/^online$/i)).toHaveLength(2);
    expect(screen.getByLabelText(/^offline$/i)).toBeTruthy();
  });

  it("stays hidden on web, where there is no local daemon", () => {
    render({ localDaemonId: null });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("stays hidden when no agent CLI is installed on this machine", () => {
    render({ localDaemonId: "daemon-with-nothing" });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("stays hidden for people who cannot edit the agent", () => {
    render({ canEdit: false });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("never offers a cloud worker as a local program", () => {
    render({
      runtimes: [ownerRuntime, runtime("cloud (this-mac)", "user-me", { runtime_mode: "cloud" })],
    });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("never offers another member's private runtime", () => {
    render({
      runtimes: [
        ownerRuntime,
        runtime("claude (theirs)", "user-other", { visibility: "private", shared_with: [] }),
      ],
    });
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("NOT_LOCAL", () => {
  it("is a sentinel, since Base UI treats the empty string as no selection", () => {
    expect(NOT_LOCAL).not.toBe("");
  });
});

describe("agentLabel", () => {
  it("prefers the machine's own name for the CLI", () => {
    expect(agentLabel(runtime("rt", "user-me", { custom_name: "work pi", provider: "pi" }))).toBe(
      "work pi",
    );
  });

  it("falls back to the provider's display name", () => {
    expect(agentLabel(runtime("rt", "user-me", { provider: "claude" }))).toMatch(/Claude/);
  });
});
