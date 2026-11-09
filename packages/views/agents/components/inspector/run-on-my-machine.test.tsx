// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { renderWithI18n } from "../../../test/i18n";
import { useAgentOwnerRuntimeStore } from "@multica/core/agents";
import {
  OWNER_DEFAULT,
  RunOnMyMachine,
  ownerConfiguredRuntimeId,
  ownerDefaultRuntime,
  resolveOwnerRuntime,
} from "./run-on-my-machine";

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

function agentOn(runtimeId: string, ownerId = "user-owner"): Agent {
  return {
    id: "agent-1",
    workspace_id: "workspace-1",
    name: "Reviewer",
    runtime_id: runtimeId,
    owner_id: ownerId,
  } as Agent;
}

// The owner's machine: a different daemon, so it is never offered as "mine".
const ownerRuntime = runtime("claude (owner-box)", "user-owner", {
  daemon_id: OTHER_DAEMON,
});
// Two agent CLIs installed on this machine.
const localClaude = runtime("claude (this-mac)", "user-me", { provider: "claude" });
const localOpenCode = runtime("opencode (this-mac)", "user-me", { provider: "opencode" });
// A second machine of the same person: must be ignored by this row.
const myOtherMachine = runtime("claude (second-mac)", "user-me", {
  daemon_id: OTHER_DAEMON,
});

const ALL = [ownerRuntime, localClaude, localOpenCode, myOtherMachine];

function render(props: Partial<React.ComponentProps<typeof RunOnMyMachine>> = {}) {
  const onBind = vi.fn();
  renderWithI18n(
    <RunOnMyMachine
      agent={agentOn(ownerRuntime.id)}
      runtimes={ALL}
      currentUserId="user-me"
      canEdit
      localDaemonId={THIS_DAEMON}
      onBind={onBind}
      {...props}
    />,
  );
  return { onBind };
}

async function openSelect() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Run on my machine" }));
  return user;
}

afterEach(() => {
  cleanup();
  useAgentOwnerRuntimeStore.setState({ entries: {} });
});

describe("RunOnMyMachine", () => {
  it("offers the owner's default plus the agents installed on this machine", async () => {
    render();
    await openSelect();

    expect(await screen.findByRole("option", { name: /Default \(owner's machine\)/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Opencode/ })).toBeTruthy();
    // Exactly one Claude: the person's second machine runs Claude too, and it
    // must stay out of this row — only this daemon's runtimes count.
    expect(screen.getAllByRole("option", { name: /Claude/ })).toHaveLength(1);
  });

  it("binds a locally installed agent", async () => {
    const { onBind } = render();
    const user = await openSelect();

    await user.click(await screen.findByRole("option", { name: /Opencode/ }));
    expect(onBind).toHaveBeenCalledWith(localOpenCode.id);
  });

  it("restores the owner's machine from the default option", async () => {
    const { onBind } = render({ agent: agentOn(localClaude.id) });
    const user = await openSelect();

    await user.click(await screen.findByRole("option", { name: /Default \(owner's machine\)/ }));
    expect(onBind).toHaveBeenCalledWith(ownerRuntime.id);
  });

  it("shows the agent's local runtime as the current value once bound", () => {
    render({ agent: agentOn(localOpenCode.id) });

    expect(screen.getByRole("combobox", { name: "Run on my machine" }).textContent).toContain(
      "Opencode",
    );
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

  it("never offers a cloud worker as a local agent", () => {
    render({
      runtimes: [
        ownerRuntime,
        runtime("cloud (this-mac)", "user-me", { runtime_mode: "cloud" }),
      ],
    });

    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("ownerDefaultRuntime", () => {
  it("prefers an online owner runtime over a newer offline one", () => {
    const online = runtime("claude (owner-box)", "user-owner", {
      daemon_id: OTHER_DAEMON,
      status: "online",
      last_seen_at: "2026-01-01T00:00:00Z",
    });
    const offline = runtime("codex (owner-box)", "user-owner", {
      daemon_id: OTHER_DAEMON,
      status: "offline",
      last_seen_at: "2026-06-01T00:00:00Z",
    });

    expect(ownerDefaultRuntime(agentOn(localClaude.id), [offline, online], "user-me")?.id)
      .toBe(online.id);
  });

  it("returns null when the owner has no runtime left", () => {
    expect(ownerDefaultRuntime(agentOn(localClaude.id), [localClaude], "user-me")).toBeNull();
  });

  it("ignores an owner runtime this person may not bind", () => {
    const privateOwnerRuntime = runtime("claude (owner-box)", "user-owner", {
      daemon_id: OTHER_DAEMON,
      visibility: "private",
      shared_with: [],
    });

    expect(
      ownerDefaultRuntime(agentOn(localClaude.id), [privateOwnerRuntime], "user-me"),
    ).toBeNull();
  });
});

describe("OWNER_DEFAULT", () => {
  it("is a sentinel, since Base UI treats the empty string as no selection", () => {
    expect(OWNER_DEFAULT).not.toBe("");
  });
});

describe("RunOnMyMachine status indicators", () => {
  it("marks online and offline local agents", async () => {
    render({
      runtimes: [
        ownerRuntime,
        runtime("claude (this-mac)", "user-me", { provider: "claude" }),
        runtime("opencode (this-mac)", "user-me", {
          provider: "opencode",
          status: "offline",
        }),
      ],
    });
    await openSelect();

    expect(await screen.findByRole("img", { name: /^online$/i })).toBeTruthy();
    expect(screen.getByRole("img", { name: /^offline$/i })).toBeTruthy();
  });

  it("shows the status dot in the trigger for the selected local agent", () => {
    render({ agent: agentOn(localOpenCode.id) });

    const trigger = screen.getByRole("combobox", { name: "Run on my machine" });
    expect(within(trigger).getByRole("img", { name: /^online$/i })).toBeTruthy();
  });
});

describe("switching back to the owner's machine", () => {
  // The owner runs two agent CLIs on one ubuntu machine. The one the agent was
  // on (pi) is *older* than the other (claude), so any activity-based guess
  // picks the wrong one — the regression this remembers its way out of.
  const ownerPi = runtime("pi (ubuntu)", "user-owner", {
    daemon_id: OTHER_DAEMON,
    provider: "pi",
    last_seen_at: "2026-01-01T00:00:00Z",
  });
  const ownerClaude = runtime("claude (ubuntu)", "user-owner", {
    daemon_id: OTHER_DAEMON,
    provider: "claude",
    last_seen_at: "2026-06-01T00:00:00Z",
  });
  const localPi = runtime("pi (this-mac)", "user-me", { provider: "pi" });
  const runtimes = [ownerPi, ownerClaude, localPi];

  it("restores the exact runtime the agent was on, not a hotter one", () => {
    const resolved = resolveOwnerRuntime(
      agentOn(localPi.id),
      runtimes,
      "user-me",
      ownerPi.id,
    );

    expect(resolved?.id).toBe(ownerPi.id);
  });

  it("falls back to the owner's best runtime when nothing is remembered", () => {
    const resolved = resolveOwnerRuntime(agentOn(localPi.id), runtimes, "user-me", null);

    expect(resolved?.id).toBe(ownerClaude.id);
  });

  it("ignores a remembered runtime that is no longer the owner's", () => {
    // Remembered entry points at a runtime that has since been rebound to a
    // teammate, so restoring it would move the agent onto the wrong machine.
    const rebound = runtime("pi (ubuntu)", "user-teammate", {
      daemon_id: OTHER_DAEMON,
      provider: "pi",
      visibility: "public",
    });

    const resolved = resolveOwnerRuntime(
      agentOn(localPi.id),
      [rebound, ownerClaude, localPi],
      "user-me",
      rebound.id,
    );

    expect(resolved?.id).toBe(ownerClaude.id);
  });

  it("remembers the owner binding across a round trip", async () => {
    const onBind = vi.fn();
    renderWithI18n(
      <RunOnMyMachine
        agent={agentOn(ownerPi.id)}
        runtimes={runtimes}
        currentUserId="user-me"
        canEdit
        localDaemonId={THIS_DAEMON}
        onBind={onBind}
      />,
    );

    const user = await openSelect();
    await user.click(await screen.findByRole("option", { name: /^Pi/ }));
    expect(onBind).toHaveBeenLastCalledWith(localPi.id);
    expect(useAgentOwnerRuntimeStore.getState().entries["agent-1"]).toBe(ownerPi.id);
  });
});

describe("ownerConfiguredRuntimeId", () => {
  // The owner's machine runs two CLIs; the local override is one of mine.
  const ownerPi = runtime("pi (ubuntu)", "user-owner", {
    daemon_id: OTHER_DAEMON,
    provider: "pi",
  });
  const ownerClaude = runtime("claude (ubuntu)", "user-owner", {
    daemon_id: OTHER_DAEMON,
    provider: "claude",
  });
  const localClaude = runtime("claude (this-mac)", "user-me", { provider: "claude" });

  it("keeps showing the owner's runtime while this laptop overrides the agent", () => {
    expect(
      ownerConfiguredRuntimeId(agentOn(localClaude.id), [ownerPi, ownerClaude, localClaude], THIS_DAEMON, ownerPi.id),
    ).toBe(ownerPi.id);
  });

  it("returns null when nothing is overridden", () => {
    expect(
      ownerConfiguredRuntimeId(agentOn(ownerPi.id), [ownerPi, ownerClaude, localClaude], THIS_DAEMON, ownerPi.id),
    ).toBeNull();
  });

  it("returns null without a remembered owner runtime", () => {
    expect(
      ownerConfiguredRuntimeId(agentOn(localClaude.id), [ownerPi, ownerClaude, localClaude], THIS_DAEMON, null),
    ).toBeNull();
  });

  it("returns null on web, where there is no local machine", () => {
    expect(
      ownerConfiguredRuntimeId(agentOn(localClaude.id), [ownerPi, ownerClaude, localClaude], null, ownerPi.id),
    ).toBeNull();
  });

  it("ignores a remembered runtime that no longer belongs to the owner", () => {
    const reassigned = runtime("pi (ubuntu)", "user-teammate", {
      daemon_id: OTHER_DAEMON,
      provider: "pi",
      visibility: "public",
    });
    expect(
      ownerConfiguredRuntimeId(agentOn(localClaude.id), [reassigned, localClaude], THIS_DAEMON, reassigned.id),
    ).toBeNull();
  });
});
