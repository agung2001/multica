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
 * An unknown shape is never guillotined — if nothing readable comes out of a
 * run, `finish()` hands back the raw log so the output is never silently empty.
 */
export interface TranscriptFormatter {
  /** Formatted text to append for this chunk, possibly empty. */
  write: (chunk: string) => string;
  /** Text to append when the run ends. */
  finish: () => string;
}

const RAW_LIMIT = 4000;

export function createTranscriptFormatter(): TranscriptFormatter {
  let buffer = "";
  let produced = false;
  let raw = "";
  // pi streams a turn as deltas and then repeats the whole message at the end;
  // emitting both would print every answer twice.
  let streamedThisTurn = false;

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
        return update.delta;
      }
      if (update.type === "text_end" && update.content) return "";
      if (update.type?.startsWith("tool") && update.toolName) {
        return `\n→ ${update.toolName}\n`;
      }
      return "";
    }

    // claude: whole messages, plus a final result summary.
    const message = event.message as
      | { role?: string; content?: unknown }
      | undefined;
    if ((type === "assistant" || type === "assistant_message") && message) {
      return contentText(message.content);
    }
    if (type === "result" && typeof event.result === "string") {
      return event.result;
    }

    // opencode: parts carry their own text.
    const part = event.part as { text?: unknown; tool?: unknown } | undefined;
    if (part && typeof part.text === "string") return part.text;

    // Generic shapes some providers use.
    if (type === "message_end" && message && message.role === "assistant") {
      if (streamedThisTurn) return "";
      return contentText(message.content);
    }
    if (typeof event.text === "string" && type !== "system") return event.text;
    if (type === "error" || type === "agent_error") {
      return `\n${typeof event.error === "string" ? event.error : JSON.stringify(event)}\n`;
    }
    return "";
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

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const block = part as { type?: string; text?: unknown; name?: unknown };
    if (block.type === "text" && typeof block.text === "string") out += block.text;
    else if (block.type === "tool_use" && typeof block.name === "string") out += `\n→ ${block.name}\n`;
  }
  return out;
}
