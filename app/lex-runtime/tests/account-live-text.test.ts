import { describe, expect, it } from "vitest";
import { claudeStdoutLines, liveDraft, liveTextSink } from "../src/providers/account-session.js";

const delta = (text: string) => JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }, session_id: "s" });
const start = JSON.stringify({ type: "stream_event", event: { type: "message_start", message: {} } });

describe("account session live text", () => {
  it("Claude token events reach the preview and stay out of the parsed stdout", () => {
    const shown: string[] = [];
    const line = claudeStdoutLines((text) => shown.push(text))!;
    expect(line(JSON.stringify({ type: "system", subtype: "init" }))).toBe(true);
    expect(line(start)).toBe(false);
    expect(line(delta("Zgodnie z art. "))).toBe(false);
    expect(line(delta("415 KC"))).toBe(false);
    expect(line(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Zgodnie z art. 415 KC" }] } }))).toBe(true);
    expect(line(JSON.stringify({ type: "result", result: "Zgodnie z art. 415 KC" }))).toBe(true);
    expect(shown).toEqual(["Zgodnie z art.", "Zgodnie z art. 415 KC"]);
    // A new message (after a tool round) starts over.
    line(start);
    line(delta("Druga"));
    expect(shown.at(-1)).toBe("Druga");
  });

  it("never shows the text tool-call protocol", () => {
    expect(liveDraft('Sprawdzam.\nLEX_TOOL_CALLS_JSON:[{"name":"x"}]')).toBe("Sprawdzam.");
  });

  it("sends deltas once; a different message waits for reset", () => {
    const deltas: string[] = [];
    const sink = liveTextSink({ onContentDelta: (text) => deltas.push(text) })!;
    sink.push("Ala");
    sink.push("Ala ma");
    sink.push("Ala ma");
    sink.push("Inny tekst");
    sink.reset();
    sink.push("Inny tekst");
    expect(deltas).toEqual(["Ala", " ma", "Inny tekst"]);
    expect(liveTextSink(undefined)).toBeUndefined();
  });
});

describe("account process output", () => {
  it("live text while the client writes; the captured stdout keeps the result, also without a final newline", async () => {
    const { runDirectForTests } = await import("../src/providers/account-session.js");
    const script = [
      `process.stdout.write(${JSON.stringify(JSON.stringify({ type: "system", subtype: "init" }) + "\n")});`,
      `process.stdout.write(${JSON.stringify(start + "\n" + delta("Zgod"))});`,
      `process.stdout.write(${JSON.stringify("\n" + delta("nie") + "\n")});`,
      `process.stdout.write(${JSON.stringify(JSON.stringify({ type: "result", result: "Zgodnie" }))});`
    ].join("");
    const shown: string[] = [];
    const run = await runDirectForTests(process.execPath, ["-e", script], undefined, process.env, 20_000, undefined, undefined, {
      onStdoutLine: claudeStdoutLines((text) => shown.push(text))!
    });
    expect(run.code).toBe(0);
    expect(shown).toEqual(["Zgod", "Zgodnie"]);
    expect(run.stdout).not.toContain("stream_event");
    expect(run.stdout).toContain('"type":"result"');
  });
});
