// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "multica_agent_owner_runtime";

/**
 * The store hydrates from localStorage when its module is first evaluated, so a
 * migration can only be observed through a fresh module instance.
 */
async function loadStore(persisted: unknown) {
  vi.resetModules();
  localStorage.setItem(KEY, JSON.stringify(persisted));
  const mod = await import("./agent-owner-runtime-store");
  return mod.useAgentOwnerRuntimeStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("agent owner runtime store", () => {
  it("drops entries written before the write guard was fixed", async () => {
    // Version 1 recorded the binding without checking whether an override was
    // already active, so an entry may name the CLI the person switched away
    // from. Those entries made the Runtime row show a local machine as the
    // owner's configuration, so they must not survive the upgrade.
    const store = await loadStore({
      state: { entries: { "agent-1": "runtime-left-behind" } },
      version: 0,
    });

    expect(store.getState().entries).toEqual({});
  });

  it("keeps entries written by this version", async () => {
    const store = await loadStore({ state: { entries: {} }, version: 2 });
    store.getState().remember("agent-1", "runtime-owner");

    expect(store.getState().entries).toEqual({ "agent-1": "runtime-owner" });
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").version).toBe(2);
  });

  it("forgets a single agent without disturbing the others", async () => {
    const store = await loadStore({ state: { entries: {} }, version: 2 });
    store.getState().remember("agent-1", "runtime-a");
    store.getState().remember("agent-2", "runtime-b");

    store.getState().forget("agent-1");

    expect(store.getState().entries).toEqual({ "agent-2": "runtime-b" });
  });
});
