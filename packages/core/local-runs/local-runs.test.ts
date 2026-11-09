// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultCommandForProvider,
  LOCAL_RUN_LIMIT,
  LOCAL_RUN_OUTPUT_LIMIT,
  type LocalRun,
} from "./types";
import { useLocalRunsStore } from "./local-runs-store";
import { splitCommandLine } from "./runner";

beforeEach(() => {
  useLocalRunsStore.setState({ runs: [], bindings: {} });
});

const store = () => useLocalRunsStore.getState();
const run = (id: string): LocalRun =>
  store().runs.find((entry) => entry.id === id) as LocalRun;

describe("local drafts", () => {
  it("starts as a draft with no agent and no output", () => {
    const id = store().create({ title: "Refactor the importer" });

    expect(run(id)).toMatchObject({
      title: "Refactor the importer",
      status: "draft",
      output: "",
      agentId: null,
      publishedIssueId: null,
    });
  });

  it("keeps newest first", () => {
    const first = store().create({ title: "one" });
    const second = store().create({ title: "two" });

    expect(store().runs.map((entry) => entry.id)).toEqual([second, first]);
  });

  it("drops the oldest draft past the cap", () => {
    for (let index = 0; index < LOCAL_RUN_LIMIT + 5; index += 1) {
      store().create({ title: `#${index}` });
    }

    expect(store().runs).toHaveLength(LOCAL_RUN_LIMIT);
    expect(store().runs.at(-1)?.title).toBe("#5");
  });

  it("appends transcript output and keeps only the tail", () => {
    const id = store().create();
    store().appendOutput(id, "hello ");
    store().appendOutput(id, "world");
    expect(run(id).output).toBe("hello world");

    store().appendOutput(id, "x".repeat(LOCAL_RUN_OUTPUT_LIMIT + 50));
    const output = run(id).output;
    expect(output.length).toBeLessThanOrEqual(LOCAL_RUN_OUTPUT_LIMIT + 40);
    expect(output.startsWith("…[earlier output dropped]")).toBe(true);
    expect(output.endsWith("x".repeat(10))).toBe(true);
  });

  it("tracks the run's status", () => {
    const id = store().create();
    store().setStatus(id, "running");
    expect(run(id).status).toBe("running");
    store().setStatus(id, "failed");
    expect(run(id).status).toBe("failed");
  });

  it("removes a draft without touching the others", () => {
    const keep = store().create({ title: "keep" });
    const drop = store().create({ title: "drop" });

    store().remove(drop);

    expect(store().runs.map((entry) => entry.id)).toEqual([keep]);
  });
});

describe("agent bindings", () => {
  it("remembers which program runs an agent here", () => {
    store().bindAgent("agent-1", {
      runtimeId: "runtime-1",
      provider: "pi",
      command: "pi -p --mode json",
      cwd: "/tmp/work",
    });

    expect(store().bindings["agent-1"]).toMatchObject({
      runtimeId: "runtime-1",
      command: "pi -p --mode json",
    });
  });

  it("unbinds one agent", () => {
    store().bindAgent("agent-1", { runtimeId: "r1", provider: "pi", command: "pi", cwd: "" });
    store().bindAgent("agent-2", { runtimeId: "r2", provider: "pi", command: "pi", cwd: "" });

    store().unbindAgent("agent-1");

    expect(Object.keys(store().bindings)).toEqual(["agent-2"]);
  });
});

describe("defaultCommandForProvider", () => {
  it("knows the non-interactive form of the providers it supports", () => {
    expect(defaultCommandForProvider("pi")).toBe("pi -p --mode json");
    expect(defaultCommandForProvider("opencode")).toContain("opencode run");
    expect(defaultCommandForProvider("claude")).toContain("claude -p");
  });

  it("returns nothing rather than guessing for unknown providers", () => {
    expect(defaultCommandForProvider("codex")).toBe("");
    expect(defaultCommandForProvider(null)).toBe("");
  });
});

describe("splitCommandLine", () => {
  it("splits plain flags", () => {
    expect(splitCommandLine("pi -p --mode json")).toEqual(["pi", "-p", "--mode", "json"]);
  });

  it("keeps quoted arguments together", () => {
    expect(splitCommandLine(`claude -p "hello world" --dir '/tmp/my repo'`)).toEqual([
      "claude",
      "-p",
      "hello world",
      "--dir",
      "/tmp/my repo",
    ]);
  });

  it("ignores extra whitespace and trailing spaces", () => {
    expect(splitCommandLine("  pi   -p  ")).toEqual(["pi", "-p"]);
  });

  it("returns an empty list for an empty command", () => {
    expect(splitCommandLine("   ")).toEqual([]);
  });
});

describe("localRunRunner", () => {
  it("is null where the platform has no process runner", async () => {
    const { localRunRunner } = await import("./runner");
    vi.stubGlobal("window", {});

    expect(localRunRunner()).toBeNull();

    vi.unstubAllGlobals();
  });
});
