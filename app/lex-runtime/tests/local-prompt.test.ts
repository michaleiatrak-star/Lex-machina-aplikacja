import path from "node:path";
import { describe, expect, it } from "vitest";
import { compactLocalPrompt } from "../src/local-prompt.js";
import { LexSkillRegistry } from "../src/registry.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

describe("prompt modelu lokalnego (Bielik, Mistral)", () => {
  it("zostają zasady, dziedzina, moduł (skrót ze ścieżką) i dane tury; odpada to, czego model lokalny nie wykonuje", () => {
    const full = [
      "[LEGENDA] [LMPII:D01:PERSON:0001] = osoba",
      "# SEMANTIC CONTRACT: prawny-router-v3\nkontrakt",
      "# CORE LEGAL RUNTIME CONTRACT\nLex Machina runtime has already loaded…",
      "# DETERMINISTIC RUNTIME WORKFLOW\nWorkflow: LEGAL_QUERY_V1.\nThe runtime controls routing.",
      "# RUNTIME-PRELOADED SEMANTIC CONTEXT\nThe following bounded excerpts…",
      "# RUNTIME-PRELOADED SEMANTIC CONTEXT: dr-04-prawo-pracy-zus-swiadczenia/modules/mod-wynagrodzenie.md\n# Wynagrodzenie\n\n> ⚡ ZMIANA STRUKTURALNA 2026-08-20 (F-78): plik podzielony.\n\n" + "Zasada wypłaty wynagrodzenia. ".repeat(200),
      "# MODEL TEJ SESJI (podaje aplikacja)\nidentyfikator modelu w aplikacji: local/bielik-11b-v3-q4km.",
      "# LOCAL LEGAL CORPUS ACCESS\nThe complete Lex Machina legal corpus… Available top-level skills: a, b, c",
      "# STRUCTURED REPORT BLUEPRINT GATE\ncall submit_report_blueprint",
      "# SĄD WŁAŚCIWY (aplikacja)\nThe court comes only from court_for_address.",
      "# SKILL (DIGEST): dr-04-prawo-pracy-zus-swiadczenia\nPrawo pracy.\n## ADAPTER RUNTIME — PORTABILITY\nnotatki hosta",
      "# DR-04 — Prawo Pracy\n## ⛔ HARD GATE — ZAKAZ CYTOWANIA Z PAMIĘCI\nNigdy z pamięci.\n## Moduły (40 łącznie)\n[✓] mod-a\n[✓] mod-b",
      "# ACTIVE SKILL SET\n- shared",
      "# MAPA WIEDZY (tryb uproszczony)\n" + "plik.md, ".repeat(300),
      "# GATE I — RUNTIME/STAGE OWNERSHIP\nWorkflow: LEGAL_QUERY_V1.",
      "# MULTI-SKILL ORCHESTRATION\nMore than one execution skill…",
      "# DŁUGIE PISMO (aplikacja)\nPismo w częściach."
    ].join("\n\n");
    const compact = compactLocalPrompt(full, "Pracodawca nie wypłacił wynagrodzenia.");
    expect(compact.length).toBeLessThan(full.length / 2);
    expect(compact.startsWith("[LEGENDA]")).toBe(true);
    for (const kept of ["# ZASADY", "local/bielik-11b-v3-q4km", "# KORPUS", "Prawo pracy.", "## ⛔ HARD GATE", "Zasada wypłaty wynagrodzenia.", "read_legal_resource dr-04-prawo-pracy-zus-swiadczenia/modules/mod-wynagrodzenie.md", "# DŁUGIE PISMO"]) {
      expect(compact).toContain(kept);
    }
    for (const dropped of ["SEMANTIC CONTRACT", "ACTIVE SKILL SET", "MAPA WIEDZY", "GATE I", "MULTI-SKILL", "submit_report_blueprint", "court_for_address", "ADAPTER RUNTIME", "ZMIANA STRUKTURALNA", "## Moduły", "LEGAL_QUERY_V1"]) {
      expect(compact).not.toContain(dropped);
    }
    // A pleading's turn keeps the court rule; a report workflow keeps its blueprint gate.
    expect(compactLocalPrompt(full, "Napisz pozew o zapłatę.")).toContain("court_for_address");
    expect(compactLocalPrompt(full.replace("Workflow: LEGAL_QUERY_V1.\nThe runtime", "Workflow: CLIENT_REPORT_V1.\nThe runtime"), "")).toContain("submit_report_blueprint");
  });

  it("prawdziwy korpus: model lokalny dostaje krótki prompt, model w chmurze pełny", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const prompts: string[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(request: { systemPrompt?: string }) {
        prompts.push(request.systemPrompt ?? "");
        return { fullText: "Odpowiedź." };
      }
    } as never);
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const ask = (model: string, primarySkill: string, query: string) =>
      executor.execute({ query: `Użytkownik: ${query}`, provider: "openai", model, primarySkill, mode: "LAIK" } as never);
    await ask("local/bielik-11b-v3-q4km", "dr-03-prawo-karne-wykroczenia-egzekucja", "Dostałem mandat 1500 zł za przekroczenie prędkości. Czy mogę odmówić przyjęcia?");
    await ask("local/mistral-nemo-12b-q4km", "dr-04-prawo-pracy-zus-swiadczenia", "Pracodawca nie wypłacił mi wynagrodzenia za wrzesień.");
    await ask("account/anthropic/default", "dr-04-prawo-pracy-zus-swiadczenia", "Pracodawca nie wypłacił mi wynagrodzenia za wrzesień.");
    const [bielik, mistral, hosted] = prompts;
    expect(bielik!.length).toBeLessThan(6_000);
    expect(mistral!.length).toBeLessThan(6_000);
    // Criminal matters keep the qualifier (user preference "Karne: +kwalifikator").
    expect(bielik).toMatch(/kwalifikator/iu);
    expect(bielik).not.toContain("MULTI-SKILL ORCHESTRATION");
    expect(hosted!.length).toBeGreaterThan(50_000);
    expect(hosted).toContain("MULTI-SKILL ORCHESTRATION");
  }, 60_000);
});
