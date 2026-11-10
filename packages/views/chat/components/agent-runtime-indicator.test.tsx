// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentRuntime } from "@multica/core/types";
import { useLocalRunsStore } from "@multica/core/local-runs";
import { runtimeListOptions } from "@multica/core/runtimes";
import { renderWithI18n } from "../../test/i18n";
import { AgentRuntimeIndicator } from "./agent-runtime-indicator";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    runtime_id: "rt-1",
    runtime_bound: true,
    name: "Coder",
    ...overrides,
  } as Agent;
}

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

function renderIndicator(target: Agent, runtimeRow: AgentRuntime | null = runtime()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (runtimeRow) {
    client.setQueryData(runtimeListOptions("ws-1").queryKey, [runtimeRow]);
  }
  renderWithI18n(
    <QueryClientProvider client={client}>
      <AgentRuntimeIndicator agent={target} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useLocalRunsStore.setState({ bindings: {} });
});
afterEach(cleanup);

describe("AgentRuntimeIndicator", () => {
  it("shows the device-local binding when this chat target has one", () => {
    useLocalRunsStore.setState({
      bindings: {
        "agent-1": {
          runtimeId: "rt-local",
          provider: "pi",
          command: "pi -p --mode json",
          cwd: "",
        },
      },
    });
    renderIndicator(agent());

    expect(screen.getByText("Run on my machine")).toBeTruthy();
    expect(screen.getByText("Run on my machine").closest("[data-agent-runtime-indicator]"))
      .toHaveAttribute("data-runtime-target", "local");
  });

  it("shows the server runtime's machine when there is no local binding", () => {
    renderIndicator(agent());

    expect(screen.getByText(/Devs-MacBook-Pro/)).toBeTruthy();
    expect(screen.getByText(/Devs-MacBook-Pro/).closest("[data-agent-runtime-indicator]"))
      .toHaveAttribute("data-runtime-target", "runtime");
  });

  it("flags an agent without a runtime", () => {
    renderIndicator(agent({ runtime_id: "", runtime_bound: false }), null);

    expect(screen.getByText("Needs a runtime")).toBeTruthy();
  });
});
