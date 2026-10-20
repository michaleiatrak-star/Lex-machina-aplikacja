import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSessionManager, codexRunSummary, streamAccountSession } from "../src/providers/account-session.js";

// Codex run with exit 0 and no agent_message (the turn spent on reasoning): one repeat
// with a request for text, then the coded error with what the run did.
const KEYS = ["LEX_CODEX_CLI", "LEX_ACCOUNT_SESSION_STATE_ROOT", "HOME", "LEX_TEST_DIR", "LEX_TEST_EMPTY_RUNS"] as const;
const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const roots: string[] = [];

const EMPTY = [
  '{"type":"thread.started","thread_id":"t1"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"i0","type":"reasoning","text":"..."}}',
  '{"type":"turn.completed","usage":{"input_tokens":118000,"cached_input_tokens":0,"output_tokens":32000,"reasoning_output_tokens":31800}}'
];

function setup(emptyRuns: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-codex-empty-"));
  roots.push(dir);
  const codex = path.join(dir, "codex");
  // Logged in; each exec stores its stdin, the first $LEX_TEST_EMPTY_RUNS runs end empty.
  fs.writeFileSync(
    codex,
    [
      "#!/bin/sh",
      'if [ "$1" = login ]; then echo "Logged in using ChatGPT"; exit 0; fi',
      'n=$(ls "$LEX_TEST_DIR"/run-* 2>/dev/null | wc -l)',
      'cat > "$LEX_TEST_DIR/run-$n"',
      'if [ "$n" -lt "$LEX_TEST_EMPTY_RUNS" ]; then',
      ...EMPTY.map((line) => `  echo '${line}'`),
      "  exit 0",
      "fi",
      `echo '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Art. 286 KK: odpowiedź."}}'`,
      "exit 0",
      ""
    ].join("\n"),
    { mode: 0o755 }
  );
  Object.assign(process.env, {
    LEX_CODEX_CLI: codex,
    LEX_ACCOUNT_SESSION_STATE_ROOT: path.join(dir, "state"),
    HOME: dir,
    LEX_TEST_DIR: dir,
    LEX_TEST_EMPTY_RUNS: String(emptyRuns)
  });
  return { runs: () => fs.readdirSync(dir).filter((name) => name.startsWith("run-")).sort().map((name) => fs.readFileSync(path.join(dir, name), "utf8")) };
}

const params = {
  model: "account/openai/default",
  systemPrompt: "SYSTEM",
  messages: [{ role: "user", content: "Zbadaj zmianę treści w artykule 286 kodeksu karnego." }],
  accountContinuity: "none"
} as never;

afterEach(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("ChatGPT (Codex): pusta odpowiedź", () => {
  it("podsumowanie przebiegu bez wiadomości: elementy i tokeny", () => {
    expect(codexRunSummary(EMPTY.join("\n"))).toBe("items=reasoning×1;in=118000;cached=0;out=32000;reasoning_out=31800");
    expect(codexRunSummary("")).toBe("items=brak");
  });

  it("pierwszy przebieg pusty: jedno ponowienie z prośbą o tekst daje odpowiedź", async () => {
    const { runs } = setup(1);
    const result = await streamAccountSession(new AccountSessionManager(), "openai", params);
    expect(result.fullText).toBe("Art. 286 KK: odpowiedź.");
    const inputs = runs();
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).not.toContain("LEX_RUNTIME_NOTE");
    expect(inputs[1]).toContain("LEX_RUNTIME_NOTE: the previous run of this exact request ended without any output text.");
  }, 30_000);

  it("dwa puste przebiegi: błąd z kodem i opisem przebiegu, bez trzeciego uruchomienia", async () => {
    const { runs } = setup(5);
    await expect(streamAccountSession(new AccountSessionManager(), "openai", params)).rejects.toThrow(
      "ACCOUNT_SESSION_EMPTY_RESPONSE:openai:items=reasoning×1;in=118000;cached=0;out=32000;reasoning_out=31800"
    );
    expect(runs()).toHaveLength(2);
  }, 30_000);
});
