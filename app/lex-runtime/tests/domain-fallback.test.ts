import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureDomainFallback, domainFallbackChoice, domainFallbackTarget, parseFallbackDomains, setDomainFallbackChoice } from "../src/domain-fallback.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

// Audyt 2026-10-09: model zapasowy routingu (Ustawienia, domyślnie wyłączony). Pytanie bez
// dziedziny z reguł: model wskazał właściwą jako pierwszą w 61–68% (Gemini flash-lite, Bielik 11B).
describe("domain fallback model", () => {
  afterEach(() => configureDomainFallback(null));

  it("reads one or two DR codes from any answer and keeps the setting off by default", () => {
    expect(parseFallbackDomains(registry, '{"dr":["dr-02","dr-14"]}')).toEqual([
      expect.stringMatching(/^dr-02-/),
      expect.stringMatching(/^dr-14-/)
    ]);
    expect(parseFallbackDomains(registry, "Dziedzina: dr-99 albo nic")).toEqual([]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-fallback-"));
    configureDomainFallback(dir);
    expect(domainFallbackChoice()).toBe("off");
    setDomainFallbackChoice("local/bielik-11b-v3-q4km");
    expect(domainFallbackChoice()).toBe("local/bielik-11b-v3-q4km");
    expect(domainFallbackTarget("local/bielik-11b-v3-q4km", { provider: "google", model: "x" })).toEqual({ provider: "openai", model: "local/bielik-11b-v3-q4km" });
    expect(domainFallbackTarget("session", { provider: "google", model: "x" })).toEqual({ provider: "google", model: "x" });
  });

  const run = async (choice: "off" | "session", query: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-fallback-"));
    configureDomainFallback(dir);
    setDomainFallbackChoice(choice);
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(request) {
        calls.push(request);
        return { fullText: request.systemPrompt.startsWith("Jesteś routerem dziedzin") ? '{"dr":["dr-02","dr-14"]}' : "Odpowiedź symulowana." };
      }
    });
    await new SafeSessionExecutor(registry, new ProviderGateway(providers)).execute({
      query: `Użytkownik: ${query}`,
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    } as never);
    const router = calls.filter((call) => call.systemPrompt.startsWith("Jesteś routerem dziedzin"));
    const main = calls.filter((call) => !call.systemPrompt.startsWith("Jesteś routerem dziedzin")).map((call) => call.systemPrompt).join("\n");
    const mainMessages = calls.filter((call) => !call.systemPrompt.startsWith("Jesteś routerem dziedzin")).map((call) => JSON.stringify(call.messages)).join("\n");
    return { router, main, mainMessages };
  };

  it("asks the chosen model only when the rules name no domain, with the pseudonymized question", async () => {
    const none = await run("session", "Mój ojciec (PESEL 44051401359, jan.nowak@example.com) zmarł w Kanadzie i zostawił tam majątek.");
    expect(none.router).toHaveLength(1);
    // The same pseudonymized text as the main model (PESEL, e-mail never leave in clear).
    expect(String(none.router[0]!.messages[0]!.content)).not.toMatch(/44051401359|jan\.nowak@example\.com/);
    expect(none.mainMessages).not.toMatch(/44051401359|jan\.nowak@example\.com/);
    expect(none.main).toMatch(/model zapasowy routingu/);
    expect(none.main).toMatch(/- dr-02-[^\n]+\n- dr-14-/);
    const named = await run("session", "Chcę rozwodu z orzeczeniem o winie męża i alimentów na dzieci.");
    expect(named.router).toHaveLength(0);
    const off = await run("off", "Mój ojciec zmarł w Kanadzie i zostawił tam majątek.");
    expect(off.router).toHaveLength(0);
  });
});
