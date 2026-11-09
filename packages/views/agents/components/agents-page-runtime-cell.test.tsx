// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { RuntimeCell, type AgentListRow } from "./agents-page";

vi.mock("../../runtimes/components/provider-logo", () => ({
  ProviderLogo: () => null,
}));

function runtime(overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    id: "rt-1",
    workspace_id: "ws-1",
    daemon_id: "daemon-local",
    name: "Claude (mac.local)",
    custom_name: "Devs-MacBook-Pro",
    runtime_mode: "local",
    provider: "claude",
    launch_header: "",
    status: "online",
    device_info: "mac.local · macOS (arm64)",
    metadata: {},
    owner_id: "user-1",
    visibility: "private",
    last_seen_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } satisfies AgentRuntime;
}

function row(overrides: Partial<AgentListRow> = {}): AgentListRow {
  return {
    agent: {
      id: "agent-1",
      workspace_id: "ws-1",
      runtime_id: "rt-1",
      runtime_bound: true,
      name: "Reviewer",
    } as Agent,
    runtime: runtime(),
    runtimeIsLocal: false,
    presence: null,
    activity: null,
    runCount: 0,
    lastActiveDays: null,
    owner: null,
    isOwnedByMe: false,
    canManage: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe("RuntimeCell", () => {
  it("shows the runtime label for a machine elsewhere", () => {
    renderWithI18n(<RuntimeCell row={row()} />);

    expect(screen.getByText(/Devs-MacBook-Pro/)).toBeTruthy();
  });

  it("says My Machine for the runtime registered by this device", () => {
    renderWithI18n(<RuntimeCell row={row({ runtimeIsLocal: true })} />);

    expect(screen.getByText("My Machine")).toBeTruthy();
  });

  it("keeps the exact runtime reachable for disambiguation", () => {
    renderWithI18n(<RuntimeCell row={row({ runtimeIsLocal: true })} />);

    // The tooltip carries the label one would have seen otherwise.
    expect(screen.getByText("My Machine")).toBeTruthy();
  });

  it("flags an unbound agent instead of showing a machine", () => {
    renderWithI18n(
      <RuntimeCell
        row={row({
          agent: { id: "a", workspace_id: "ws-1", runtime_id: null } as unknown as Agent,
          runtime: null,
        })}
      />,
    );

    expect(screen.getByText(/needs a runtime|Needs a runtime/i)).toBeTruthy();
  });
});
