"use client";

/**
 * Splits a command line the way a shell would, without the shell.
 *
 * Local runs spawn a program directly (no `sh -c`), so the string a person types
 * has to become an argv array here. Unknown escapes stay literal — this is a
 * convenience for flags and quoted paths, not a shell.
 */
export function splitCommandLine(command: string): string[] {
  const argv: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;

  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (char === " " || char === "\t" || char === "\n") {
      if (started) {
        argv.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }
  if (started) argv.push(current);
  return argv;
}

/** Output chunks and the final status a local run reports back to the board. */
export type LocalRunExit = {
  code: number | null;
  /** Set when the run never started, e.g. the program is not installed. */
  error?: string;
};

export type LocalRunStartInput = {
  /** Program plus arguments, already resolved to argv by the caller. */
  argv: string[];
  /** Directory to run in. Empty means the user's home directory. */
  cwd: string;
  /** Written to the program's stdin, then stdin is closed. */
  prompt: string;
  onOutput: (chunk: string) => void;
  onExit: (result: LocalRunExit) => void;
};

/**
 * Bridge to the platform's process runner.
 *
 * Desktop supplies it through the preload script; web has no such thing, which
 * is why the board has to say "desktop only" instead of silently doing nothing.
 */
export interface LocalRunRunner {
  start: (input: LocalRunStartInput) => { stop: () => void };
}

interface LocalRunAPILike {
  start?: (input: {
    argv: string[];
    cwd: string;
    prompt: string;
  }) => Promise<{ runId: string }>;
  onOutput?: (listener: (runId: string, chunk: string) => void) => () => void;
  onExit?: (
    listener: (runId: string, result: { code: number | null; error?: string }) => void,
  ) => () => void;
  stop?: (runId: string) => void;
}

function readAPI(): LocalRunAPILike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { localRunAPI?: LocalRunAPILike }).localRunAPI;
}

/**
 * The platform runner, or null where local execution is impossible (web).
 *
 * Kept as a function rather than a module-level constant so tests can install a
 * fake between cases.
 */
export function localRunRunner(): LocalRunRunner | null {
  const api = readAPI();
  if (!api?.start || !api.onOutput || !api.onExit) return null;

  return {
    start: ({ argv, cwd, prompt, onOutput, onExit }) => {
      let runId: string | null = null;
      let stopped = false;
      let offOutput: (() => void) | null = null;
      let offExit: (() => void) | null = null;

      const detach = () => {
        offOutput?.();
        offExit?.();
        offOutput = null;
        offExit = null;
      };

      offOutput = api.onOutput?.((id, chunk) => {
        if (id === runId) onOutput(chunk);
      }) ?? null;
      offExit = api.onExit?.((id, result) => {
        if (id !== runId) return;
        detach();
        onExit(result);
      }) ?? null;

      void api
        .start?.({ argv, cwd, prompt })
        .then((started) => {
          runId = started.runId;
          // The process may have died before the id came back; ask the platform
          // to end the subscription rather than waiting for an event that will
          // never fire.
          if (stopped) api.stop?.(runId);
        })
        .catch((error: unknown) => {
          detach();
          onExit({ code: null, error: error instanceof Error ? error.message : String(error) });
        });

      return {
        stop: () => {
          stopped = true;
          if (runId) api.stop?.(runId);
        },
      };
    },
  };
}
