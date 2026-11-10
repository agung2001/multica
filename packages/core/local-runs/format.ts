"use client";

/**
 * Turns an agent CLI's streaming output into something a person can read.
 *
 * `pi -p --mode json`, `claude -p --output-format stream-json` and
 * `opencode run --format json` all print newline-delimited JSON that includes
 * the entire system prompt and every token event. Printing that verbatim buries
 * the answer in hundreds of kilobytes of protocol, so the run renders the
 * conversation instead: what the agent said, and which tools it used.
 *
 * The same pass also emits structured transcript events. Local runs have no
 * server-side task message table, so these events are what let the ordinary run
 * block stream tool calls and results while the process is still alive.
 *
 * An unknown shape is never guillotined — if nothing readable comes out of a
 * run, `finish()` hands back the raw log so the output is never silently empty.
 */
export type TranscriptEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | {
      type: "tool_use";
      tool: string;
      input?: Record<string, unknown>;
      callId?: string;
    }
  | {
      type: "tool_result";
      tool?: string;
      output: string;
      callId?: string;
      output_truncated?: boolean;
    }
  | { type: "error"; content: string };

export interface TranscriptFormatter {
  /** Formatted text to append for this chunk, possibly empty. */
  write: (chunk: string) => string;
  /** Text to append when the run ends. */
  finish: () => string;
}

export interface TranscriptFormatterOptions {
  /** Structured events for a live run block, in stream order. */
  onEvent?: (event: TranscriptEvent) => void;
}

const RAW_LIMIT = 4000;

export function createTranscriptFormatter(
  options: TranscriptFormatterOptions = {},
): TranscriptFormatter {
  let buffer = "";
  let produced = false;
  let raw = "";
  // pi streams a turn as deltas and then repeats the whole message at the end;
  // emitting both would print every answer twice.
  let streamedThisTurn = false;

  const emit = (event: TranscriptEvent) => {
    if (
      (event.type === "text" || event.type === "thinking" || event.type === "error") &&
      !event.content
    ) {
      return;
    }
    if (event.type === "tool_result" && !event.output) return;
    options.onEvent?.(event);
  };

  const remember = (line: string) => {
    if (raw.length < RAW_LIMIT) raw += `${line}\n`;
  };

  const formatEvent = (event: Record<string, unknown>): string => {
    const type = typeof event.type === "string" ? event.type : "";

    // pi: token-level stream. Deltas are the answer as it is written.
    const update = event.assistantMessageEvent as
      | { type?: string; delta?: string; content?: string; toolName?: string }
      | undefined;
    if (type === "turn_start") {
      streamedThisTurn = false;
      return "";
    }
    if (type === "message_update" && update) {
      if (update.type === "text_delta" && update.delta) {
        streamedThisTurn = true;
        emit({ type: "text", content: update.delta });
        return update.delta;
      }
      if (update.type === "thinking_delta" && update.delta) {
        emit({ type: "thinking", content: update.delta });
        return "";
      }
      if (update.type === "text_end" && update.content) return "";
      return "";
    }

    // pi: tool calls are separate top-level events, with their input and
    // result. The assistant-message stream only says that a tool is running.
    if (type === "tool_execution_start") {
      const tool = typeof event.toolName === "string" && event.toolName ? event.toolName : "tool";
      const input = objectValue(event.args);
      emit({
        type: "tool_use",
        tool,
        ...(input ? { input } : {}),
        ...(typeof event.toolCallId === "string" ? { callId: event.toolCallId } : {}),
      });
      return `\n→ ${tool}${toolInputPreview(input)}\n`;
    }
    if (type === "tool_execution_end") {
      const output = toolOutputText(event.result);
      if (output) {
        emit({
          type: "tool_result",
          ...(typeof event.toolName === "string" && event.toolName
            ? { tool: event.toolName }
            : {}),
          output,
          ...(typeof event.toolCallId === "string" ? { callId: event.toolCallId } : {}),
        });
      }
      // A failed tool is the one result worth repeating in the reply: it is
      // the reason the run may stop, not just another step to inspect.
      return event.isError === true && output ? `\n${output}\n` : "";
    }

    // claude: whole messages, plus a final result summary.
    const message = event.message as
      | { role?: string; content?: unknown }
      | undefined;
    if (type === "assistant" || type === "assistant_message") {
      if (!message) return "";
      return formatContent(message.content);
    }
    if (type === "user" && message) {
      // claude reports tool results as user messages carrying tool_result
      // blocks. They belong in the run transcript, never in the reply text.
      emitToolResults(message.content);
      return "";
    }
    if (type === "result" && typeof event.result === "string") {
      if (event.result) emit({ type: "text", content: event.result });
      return event.result;
    }

    // opencode: parts carry their own text and tool state.
    const part = event.part as
      | {
          type?: string;
          text?: unknown;
          tool?: unknown;
          state?: { input?: unknown; output?: unknown; status?: string };
        }
      | undefined;
    if (part) {
      if (typeof part.text === "string") {
        if (part.text) emit({ type: "text", content: part.text });
        return part.text;
      }
      if (typeof part.tool === "string") {
        const input = objectValue(part.state?.input);
        emit({
          type: "tool_use",
          tool: part.tool,
          ...(input ? { input } : {}),
        });
        const output =
          typeof part.state?.output === "string" ? part.state.output : "";
        if (output && part.state?.status === "completed") {
          emit({ type: "tool_result", tool: part.tool, output });
        }
        return `\n→ ${part.tool}${toolInputPreview(input)}\n`;
      }
    }

    // Generic shapes some providers use.
    if (type === "message_end" && message && message.role === "assistant") {
      if (streamedThisTurn) return "";
      return formatContent(message.content);
    }
    if (typeof event.text === "string" && type !== "system") {
      if (event.text) emit({ type: "text", content: event.text });
      return event.text;
    }
    if (type === "error" || type === "agent_error") {
      const content = typeof event.error === "string" ? event.error : JSON.stringify(event);
      emit({ type: "error", content });
      return `\n${content}\n`;
    }
    return "";
  };

  const formatContent = (content: unknown): string => {
    if (typeof content === "string") {
      if (content) emit({ type: "text", content });
      return content;
    }
    if (!Array.isArray(content)) return "";
    let out = "";
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const block = part as {
        type?: string;
        text?: unknown;
        name?: unknown;
        input?: unknown;
        content?: unknown;
      };
      if (block.type === "text" && typeof block.text === "string") {
        if (block.text) emit({ type: "text", content: block.text });
        out += block.text;
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        const input = objectValue(block.input);
        emit({
          type: "tool_use",
          tool: block.name,
          ...(input ? { input } : {}),
        });
        out += `\n→ ${block.name}${toolInputPreview(input)}\n`;
      }
    }
    return out;
  };

  const emitToolResults = (content: unknown) => {
    if (!Array.isArray(content)) return;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const block = part as {
        type?: string;
        tool_use_id?: unknown;
        content?: unknown;
      };
      if (block.type !== "tool_result") continue;
      const output = toolOutputText(block.content);
      if (!output) continue;
      emit({
        type: "tool_result",
        output,
        ...(typeof block.tool_use_id === "string" ? { callId: block.tool_use_id } : {}),
      });
    }
  };

  const formatLine = (line: string): string => {
    const trimmed = line.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      remember(trimmed);
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        // `message_start` repeats the message `message_end` already carried;
        // emitting both duplicates the whole answer.
        if (parsed.type === "message_start") return "";
        return formatEvent(parsed);
      } catch {
        // Not JSON after all (a plain-text CLI): show the line.
        return `${line}\n`;
      }
    }
    remember(line);
    return `${line}\n`;
  };

  return {
    write: (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      let out = "";
      for (const line of lines) out += formatLine(line);
      if (out) produced = true;
      return out;
    },
    finish: () => {
      let out = "";
      if (buffer) {
        out += formatLine(buffer);
        buffer = "";
      }
      if (out) produced = true;
      // Nothing readable came out: show what the program actually printed,
      // because a blank pane cannot be acted on.
      return produced ? "" : raw ? `\n${raw}` : "";
    },
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolInputPreview(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const command = stringValue(input.command) || stringValue(input.cmd);
  if (command) return `\n$ ${command}`;
  const path = stringValue(input.file_path) || stringValue(input.path);
  if (path) return `\n${path}`;
  const query = stringValue(input.query) || stringValue(input.pattern);
  if (query) return `\n${query}`;
  const description = stringValue(input.description);
  if (description) return `\n${description}`;
  return "";
}

/**
 * A tool result is a string for some providers and a content-block object for
 * others. Flatten the readable text so the transcript shows the same thing a
 * terminal would have shown.
 */
function toolOutputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => toolOutputText(part)).filter(Boolean).join("\n");
  }
  if (!value || typeof value !== "object") return "";
  const result = value as {
    text?: unknown;
    output?: unknown;
    content?: unknown;
  };
  if (typeof result.text === "string") return result.text;
  if (typeof result.output === "string") return result.output;
  if (result.content !== undefined) return toolOutputText(result.content);
  return "";
}
