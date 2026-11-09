import { ipcMain, webContents } from "electron";
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "child_process";
import { existsSync } from "fs";
import { delimiter } from "path";
import { homedir } from "os";
import {
  LOCAL_RUN_EXIT_CHANNEL,
  LOCAL_RUN_OUTPUT_CHANNEL,
  LOCAL_RUN_START_CHANNEL,
  LOCAL_RUN_STOP_CHANNEL,
  type LocalRunExitResult,
  type LocalRunStartRequest,
  type LocalRunStartResult,
} from "../shared/local-run";

type Running = {
  child: ChildProcessWithoutNullStreams;
  senderId: number;
};

const running = new Map<string, Running>();
let nextId = 0;

function send(senderId: number, channel: string, ...args: unknown[]) {
  const contents = webContents.fromId(senderId);
  // The window can be gone (closed tab, quit) while the program is still
  // alive; dropping the event is the correct outcome, not an error.
  if (!contents || contents.isDestroyed()) return;
  contents.send(channel, ...args);
}

/**
 * Directories an agent CLI commonly lives in that a GUI app's PATH omits.
 *
 * A window launched from Finder inherits `/usr/bin:/bin:/usr/sbin:/sbin`, so a
 * CLI installed by Homebrew, npm, bun or cargo is invisible even though the
 * user runs it fine from a terminal. Augmenting PATH is what makes "run on my
 * machine" mean the same thing inside the app as outside it.
 */
function extraPathEntries(): string[] {
  const home = homedir();
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${home}/.local/bin`,
    `${home}/.bun/bin`,
    `${home}/.volta/bin`,
    `${home}/.npm-global/bin`,
    `${home}/.cargo/bin`,
    `${home}/.local/share/pnpm`,
  ].filter((entry) => existsSync(entry));
}

const resolvedPrograms = new Map<string, string>();

/** Absolute path of a bare program name, or the name itself when not found. */
function resolveProgram(program: string): string {
  if (program.includes("/")) return program;
  const cached = resolvedPrograms.get(program);
  if (cached) return cached;

  const path = [process.env.PATH ?? "", ...extraPathEntries()].filter(Boolean).join(delimiter);
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const candidate = `${dir}/${program}`;
    if (existsSync(candidate)) {
      resolvedPrograms.set(program, candidate);
      return candidate;
    }
  }
  // Last resort: ask the user's own login shell, which knows about version
  // managers and rc-file PATH edits this process never sees.
  try {
    const found = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", `command -v ${program}`], {
      encoding: "utf8",
      timeout: 3000,
    }).trim().split("\n").pop();
    if (found && existsSync(found)) {
      resolvedPrograms.set(program, found);
      return found;
    }
  } catch {
    // Not found there either; the spawn below reports the ENOENT.
  }
  return program;
}

function resolveCwd(requested: string): string {
  const cwd = requested.trim();
  if (!cwd) return homedir();
  if (!existsSync(cwd)) throw new Error(`folder does not exist: ${cwd}`);
  return cwd;
}

function start(senderId: number, request: LocalRunStartRequest): LocalRunStartResult {
  if (!Array.isArray(request.argv) || request.argv.length === 0) {
    throw new Error("no program to run");
  }
  const [requestedProgram, ...args] = request.argv;
  const program = resolveProgram(requestedProgram);
  const child = spawn(program, args, {
    cwd: resolveCwd(request.cwd ?? ""),
    env: {
      ...process.env,
      PATH: [process.env.PATH ?? "", ...extraPathEntries()].filter(Boolean).join(delimiter),
    },
    // No shell: the argv was split in the renderer and a shell would re-expand
    // whatever the prompt contains.
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  nextId += 1;
  const runId = `local-run-${nextId}`;
  running.set(runId, { child, senderId });

  const forward = (chunk: Buffer) => {
    if (senderId) send(senderId, LOCAL_RUN_OUTPUT_CHANNEL, runId, chunk.toString("utf8"));
  };
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);

  const finish = (result: LocalRunExitResult) => {
    if (!running.has(runId)) return;
    running.delete(runId);
    send(senderId, LOCAL_RUN_EXIT_CHANNEL, runId, result);
  };

  child.on("error", (error: Error) => {
    // A missing program surfaces here rather than as a non-zero exit, so the
    // run can say which binary was not found instead of "failed".
    finish({
      code: null,
      error: `${requestedProgram}: ${error.message}. Check that the command runs in a terminal.`,
    });
  });
  child.on("close", (code: number | null) => finish({ code }));

  try {
    child.stdin.end(request.prompt ?? "");
  } catch {
    // The process may exit before reading stdin (e.g. bad flags); the close
    // handler still reports the real outcome.
  }

  return { runId };
}

function stop(runId: string) {
  const entry = running.get(runId);
  if (!entry) return;
  entry.child.kill("SIGTERM");
  // A CLI that ignores SIGTERM would keep the slot forever; escalate after a
  // grace period so the board's Stop button always ends the run.
  setTimeout(() => {
    if (running.has(runId)) entry.child.kill("SIGKILL");
  }, 4000).unref?.();
}

export function registerLocalRun(): void {
  ipcMain.handle(LOCAL_RUN_START_CHANNEL, (event, request: LocalRunStartRequest) =>
    start(event.sender.id, request),
  );
  ipcMain.handle(LOCAL_RUN_STOP_CHANNEL, (_event, runId: string) => {
    stop(runId);
  });
}

/** Kills anything still running; called when the app quits. */
export function stopAllLocalRuns(): void {
  for (const runId of [...running.keys()]) stop(runId);
}
