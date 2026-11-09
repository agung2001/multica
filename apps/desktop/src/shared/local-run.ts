/**
 * Channels for running an agent program from the local board.
 *
 * These runs are private to this device: no server call is involved in either
 * direction, which is the whole point of the board.
 */
export const LOCAL_RUN_START_CHANNEL = "local-run:start";
export const LOCAL_RUN_STOP_CHANNEL = "local-run:stop";
export const LOCAL_RUN_OUTPUT_CHANNEL = "local-run:output";
export const LOCAL_RUN_EXIT_CHANNEL = "local-run:exit";

export interface LocalRunStartRequest {
  /** Program and arguments, already split. Never passed through a shell. */
  argv: string[];
  /** Working directory; empty means the user's home directory. */
  cwd: string;
  /** Written to stdin, then stdin is closed. */
  prompt: string;
}

export interface LocalRunStartResult {
  runId: string;
}

export interface LocalRunExitResult {
  code: number | null;
  error?: string;
}
