// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createTranscriptFormatter, type TranscriptEvent } from "./format";

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

describe("local transcript formatter", () => {
  it("streams pi tool calls with their command into the reply and transcript", () => {
    const events: TranscriptEvent[] = [];
    const formatter = createTranscriptFormatter({ onEvent: (event) => events.push(event) });

    const start = formatter.write(
      json({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "bash",
        args: { command: "ls -la" },
      }),
    );
    expect(start).toContain("→ bash");
    expect(start).toContain("$ ls -la");
    expect(events).toEqual([
      {
        type: "tool_use",
        tool: "bash",
        input: { command: "ls -la" },
        callId: "call-1",
      },
    ]);

    const end = formatter.write(
      json({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "file.txt" }] },
        isError: false,
      }),
    );
    expect(end).toBe("");
    expect(events[1]).toEqual({
      type: "tool_result",
      tool: "bash",
      output: "file.txt",
      callId: "call-1",
    });
  });

  it("emits thinking separately from the answer text", () => {
    const events: TranscriptEvent[] = [];
    const formatter = createTranscriptFormatter({ onEvent: (event) => events.push(event) });

    expect(
      formatter.write(
        json({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_delta", delta: "Checking files" },
        }),
      ),
    ).toBe("");
    expect(
      formatter.write(
        json({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Done" },
        }),
      ),
    ).toBe("Done");

    expect(events).toEqual([
      { type: "thinking", content: "Checking files" },
      { type: "text", content: "Done" },
    ]);
  });

  it("reads Claude tool blocks without putting their output in the reply", () => {
    const events: TranscriptEvent[] = [];
    const formatter = createTranscriptFormatter({ onEvent: (event) => events.push(event) });

    const reply = formatter.write(
      json({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Reading" },
            { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "README.md" } },
          ],
        },
      }),
    );
    expect(reply).toContain("Reading");
    expect(reply).toContain("→ Read");
    expect(reply).toContain("README.md");

    const result = formatter.write(
      json({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool-1", content: "file body" },
          ],
        },
      }),
    );
    expect(result).toBe("");
    expect(events).toEqual([
      { type: "text", content: "Reading" },
      {
        type: "tool_use",
        tool: "Read",
        input: { file_path: "README.md" },
      },
      { type: "tool_result", output: "file body", callId: "tool-1" },
    ]);
  });
});
