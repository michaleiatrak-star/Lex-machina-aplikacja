import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AccountSessionManager,
  accountLoginArgs,
  accountSessionModelId,
  accountSessionResumeMode,
  geminiGoogleLoginPresent,
  parseGeminiResult,
  selectGeminiGoogleLogin
} from "../src/providers/account-session.js";
import { DynamicModelCatalog } from "../src/providers/model-catalog.js";
import { newestModelFamilies, parseModelFamily } from "../src/providers/model-families.js";
import { AI_SDK_MODEL_FACTORIES } from "../src/providers/ai-sdk-factories.js";

const roots: string[] = [];
const previous = {
  clients: process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT,
  geminiHome: process.env.GEMINI_CLI_HOME
};

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-gemini-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const [key, value] of [
    ["LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT", previous.clients],
    ["GEMINI_CLI_HOME", previous.geminiHome]
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Google Gemini: klucz API", () => {
  it("fabryka AI SDK tworzy model Gemini bez połączenia sieciowego", async () => {
    const factory = AI_SDK_MODEL_FACTORIES.google;
    expect(factory.packageName).toBe("@ai-sdk/google");
    expect(await factory.createModel({ apiKey: "test-key", model: "gemini-2.5-pro" })).toBeTruthy();
  });

  it("lista modeli: tylko modele generujące treść, bez prefiksu models/", async () => {
    const calls: string[] = [];
    const catalog = new DynamicModelCatalog(
      { getApiKey: async () => "g-key" },
      async (input, init) => {
        calls.push(String(input));
        expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
        return Response.json({
          models: [
            { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro", inputTokenLimit: 1048576, supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }
          ]
        });
      }
    );
    const models = await catalog.listAll("google");
    expect(calls[0]).toContain("generativelanguage.googleapis.com/v1beta/models");
    expect(models).toEqual([
      expect.objectContaining({ provider: "google", id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro" })
    ]);
  });

  it("rodziny modeli Gemini: dwie najnowsze wersje pro/flash, bez lite", () => {
    expect(parseModelFamily("google", "gemini-2.5-pro")).toEqual({ family: "gemini-pro", version: [2, 5] });
    expect(parseModelFamily("google", "gemini-3-pro-preview")).toEqual({ family: "gemini-pro", version: [3] });
    expect(parseModelFamily("google", "gemini-2.5-flash-lite")).toBeNull();
    const kept = newestModelFamilies(
      ["gemini-1.5-pro", "gemini-2.5-pro", "gemini-3-pro-preview", "gemini-2.5-flash"].map((id) => ({
        provider: "google" as const,
        id,
        displayName: id,
        selectable: true
      }))
    ).map((model) => model.id);
    expect(kept).toEqual(expect.arrayContaining(["gemini-3-pro-preview", "gemini-2.5-pro", "gemini-2.5-flash"]));
    expect(kept).not.toContain("gemini-1.5-pro");
  });
});

describe("Google Gemini: konto przez Gemini CLI", () => {
  it("model konta, logowanie i brak wznawiania sesji", () => {
    expect(accountSessionModelId("google")).toBe("account/google/default");
    expect(accountSessionResumeMode("google")).toBe("LEX_CONTEXT_ONLY");
    expect(accountLoginArgs("google")).toEqual([]);
  });

  it("wybiera „Login with Google” bez nadpisywania innych ustawień i wykrywa zalogowanie", async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ ui: { theme: "Dark" } }));
    await selectGeminiGoogleLogin(dir);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"))).toEqual({
      ui: { theme: "Dark" },
      security: { auth: { selectedType: "oauth-personal" } }
    });
    expect(geminiGoogleLoginPresent(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, "oauth_creds.json"), "{}");
    expect(geminiGoogleLoginPresent(dir)).toBe(true);
  });

  it("czyta wynik JSON i błąd braku logowania", () => {
    expect(parseGeminiResult('Approval mode overridden.\n{"session_id":"s","response":"ok"}')).toEqual({
      text: "ok",
      error: null
    });
    expect(
      parseGeminiResult('{"error":{"type":"Error","message":"Please set an Auth method","code":41}}').error
    ).toEqual({ message: "Please set an Auth method", code: 41 });
  });

  it.skipIf(process.platform === "win32")(
    "wywołuje przypięty Gemini CLI: treść na stdin, JSON, tryb tylko do odczytu",
    async () => {
      const root = tempDir();
      process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT = root;
      process.env.GEMINI_CLI_HOME = tempDir();
      const packageDir = path.join(root, "google", "node_modules", "@google", "gemini-cli");
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: "0.62.0" }));
      const binDir = path.join(root, "google", "node_modules", ".bin");
      fs.mkdirSync(binDir, { recursive: true });
      const argsFile = path.join(root, "args.txt");
      const stdinFile = path.join(root, "stdin.txt");
      const bin = path.join(binDir, "gemini");
      fs.writeFileSync(
        bin,
        `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\ncat > '${stdinFile}'\nprintf '{"session_id":"x","response":"Gotowe z Gemini"}'\n`
      );
      fs.chmodSync(bin, 0o755);

      const text = await new AccountSessionManager().runText("google", "PROMPT LEX", undefined, undefined, [], null, true);
      expect(text).toBe("Gotowe z Gemini");
      const args = fs.readFileSync(argsFile, "utf8").trim().split("\n");
      expect(args).toEqual(["-p", "", "-o", "json", "--approval-mode", "plan", "--skip-trust"]);
      expect(fs.readFileSync(stdinFile, "utf8")).toBe("PROMPT LEX");
    }
  );
});
