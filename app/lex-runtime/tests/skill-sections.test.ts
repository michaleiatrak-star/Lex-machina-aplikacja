import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { describe, expect, it } from "vitest";
import { compactForModel, laterTurn } from "../src/skill-sections.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

const text = [
  "# PLIK",
  "Wstęp.",
  "<!-- lex:wykonuje-aplikacja: G8 -->",
  "## ZNACZNIK OBOWIĄZKOWY",
  "Procedura nadawania znaczników.",
  "### Szczegóły",
  "```",
  "## to nie nagłówek",
  "```",
  "## KOLIZJA Z ORZECZNICTWEM",
  "Reguła dla modelu.",
  "<!-- lex:wykonuje-aplikacja: NIEZNANY -->",
  "## ZOSTAJE",
  "Treść."
].join("\n");

describe("sections executed by the application", () => {
  it("replaces a marked section of a known component up to the next heading of its level", () => {
    const result = compactForModel(text, true);
    expect(result.text).toContain("## ZNACZNIK OBOWIĄZKOWY [wykonuje aplikacja: G8]");
    expect(result.text).not.toContain("Procedura nadawania znaczników.");
    expect(result.text).not.toContain("to nie nagłówek");
    expect(result.text).toContain("## KOLIZJA Z ORZECZNICTWEM\nReguła dla modelu.");
    expect(result.compacted).toEqual([expect.objectContaining({ heading: "ZNACZNIK OBOWIĄZKOWY", component: "G8" })]);
  });

  it("keeps a section marked with a component the application does not run, and everything when switched off", () => {
    expect(compactForModel(text, true).text).toContain("## ZOSTAJE\nTreść.");
    expect(compactForModel(text, false).text).toBe(text);
    expect(compactForModel("# Bez znaczników", true).compacted).toEqual([]);
    expect(compactForModel("<!-- lex:wykonuje-aplikacja: HISTORIA -->\n## HISTORIA ZMIAN\n- 1.0 opis", true).text).toBe(
      "## HISTORIA ZMIAN [pominięte: historia zmian pliku (metadane audytu)]\n"
    );
  });
});


describe("components inactive in a turn", () => {
  it("keeps the section of a component the application does not run in this turn", () => {
    const marked = "# P\n<!-- lex:wykonuje-aplikacja: DISCLAIMER -->\n## TREŚĆ\nWariant.\n";
    expect(compactForModel(marked, true).text).toContain("## TREŚĆ [wykonuje aplikacja: DISCLAIMER]");
    expect(compactForModel(marked, true, new Set(["DISCLAIMER"])).text).toBe(marked);
  });

  it("a free-text legal turn of an account model gets the disclaimer procedure as a reference", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "disclaimer",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Art. 286 KK — oszustwo." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    await executor.execute({
      query: "Czy to oszustwo z art. 286 KK?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    });
    const prompt = calls[0]!.systemPrompt ?? "";
    expect(prompt).toContain("## TREŚĆ DISCLAIMERA — DWA WARIANTY [wykonuje aplikacja: DISCLAIMER]");
    expect(prompt).not.toContain("### TRYB LAIK (uproszczony)");
  }, 60_000);
});

describe("sections of a later stage of the thread", () => {
  const marked = "# P\nW1.\n<!-- lex:wczytaj-gdy: KOLEJNA-TURA -->\n## W2\nProjekt.\n### Szczegóły\nx\n## DALEJ\nZostaje.\n";

  it("defers a marked section until the stage, keeps unknown stages and whole files", () => {
    const first = compactForModel(marked, true, new Set(), new Set());
    expect(first.text).toContain("## W2 [etap późniejszy: aplikacja dołączy tę sekcję od drugiej tury");
    expect(first.text).not.toContain("Projekt.");
    expect(first.text).toContain("## DALEJ\nZostaje.");
    expect(first.compacted).toEqual([expect.objectContaining({ component: "ETAP:KOLEJNA-TURA" })]);
    expect(compactForModel(marked, true, new Set(), new Set(["KOLEJNA-TURA"])).text).toContain("Projekt.");
    expect(compactForModel(marked, true).text).toContain("Projekt.");
    expect(compactForModel(marked.replace("KOLEJNA-TURA", "INNY"), true, new Set(), new Set()).text).toContain("Projekt.");
  });

  it("a mark right above the next heading stays with that section", () => {
    const two = "<!-- lex:wykonuje-aplikacja: DISCLAIMER -->\n## A\na\n<!-- lex:wczytaj-gdy: KOLEJNA-TURA -->\n## B\nb\n<!-- lex:wykonuje-aplikacja: DISCLAIMER -->\n## C\nc\n";
    const result = compactForModel(two, true, new Set(), new Set());
    expect(result.compacted.map((item) => item.component)).toEqual(["DISCLAIMER", "ETAP:KOLEJNA-TURA", "DISCLAIMER"]);
    expect(result.text).not.toMatch(/^[abc]$/mu);
  });

  it("recognises a thread with an earlier answer", () => {
    expect(laterTurn("Napisz apelację.")).toBe(false);
    expect(laterTurn("Użytkownik: Napisz apelację.\n\nAsystent: Rama W1.\n\nUżytkownik: Zatwierdzam.")).toBe(true);
    expect(laterTurn("[Streszczenie wcześniejszej części rozmowy (4 wiadomości)]\n\nUżytkownik: dalej")).toBe(true);
  });

  async function pleadingPrompt(query: string): Promise<string> {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "stage",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Rama pisma." };
      }
    });
    await new SafeSessionExecutor(registry, new ProviderGateway(providers)).execute({
      query,
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    });
    return calls[0]!.systemPrompt ?? "";
  }

  it("the first turn of a pleading gets W2/W3 as headings, a later turn in full", async () => {
    const first = await pleadingPrompt("Napisz apelację od wyroku sądu rejonowego w sprawie o zapłatę.");
    expect(first).toContain("# SKILL WYKONAWCZY WG ROUTERA: pisma-procesowe-v3");
    expect(first).toContain("## WIADOMOŚĆ 2 — PROJEKT PISMA [etap późniejszy");
    expect(first).toContain("## WIADOMOŚĆ 1 — RAMA I STRATEGIA");
    const later = await pleadingPrompt(
      "Użytkownik: Napisz apelację od wyroku sądu rejonowego w sprawie o zapłatę.\n\nAsystent: Rama W1.\n\nUżytkownik: Zatwierdzam ramę, napisz apelację."
    );
    expect(later).not.toContain("[etap późniejszy");
    expect(later).toContain("## WIADOMOŚĆ 2 — PROJEKT PISMA\n");
  }, 120_000);
});

describe("frontmatter metadata the application reads itself", () => {
  const skill = [
    "---",
    "name: router",
    'version: "3.62"',
    "description: \"Opis.\"",
    "dependencies:",
    "  requires:",
    "    - shared",
    "  # komentarz w bloku",
    "escalation:",
    '  - "brak źródła → oznacz ⚠️ [NIEWERYFIKOWANE]"',
    "required_modules:",
    "  - shared/DISCLAIMER.md  # opis",
    "cp_gate: true",
    "changelog: |",
    "  Wersja bieżąca: 3.62",
    "---",
    "# Treść"
  ].join("\n");

  it("drops only the listed keys and keeps rules and unknown keys", () => {
    const result = compactForModel(skill, true);
    expect(result.text.split("# pominięte")[0]).not.toMatch(/dependencies|required_modules|changelog|DISCLAIMER\.md|Wersja bieżąca|requires/u);
    expect(result.text).toContain('version: "3.62"');
    expect(result.text).toContain("escalation:\n  - \"brak źródła");
    expect(result.text).toContain("cp_gate: true");
    expect(result.text).toContain("# pominięte metadane (czyta aplikacja): dependencies, required_modules, changelog");
    expect(result.text.endsWith("---\n# Treść")).toBe(true);
    expect(result.compacted).toEqual([expect.objectContaining({ component: "METADANE" })]);
    expect(compactForModel(skill, false).text).toBe(skill);
  });

  it("leaves text without frontmatter unchanged", () => {
    expect(compactForModel("# Plik\nname: x", true)).toEqual({ text: "# Plik\nname: x", compacted: [] });
  });
});

describe("marked sections in a real turn", () => {
  it("sends the model a reference instead of a section the application executes, and records it", async () => {
    const source = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-sections-"));
    fs.cpSync(source, root, { recursive: true, filter: (item) => !item.includes(`${path.sep}node_modules`) });
    const file = path.join(root, "shared", "HIERARCHIA-ZRODEL.md");
    const heading = "## PROCEDURA — GDZIE I KIEDY STOSOWAĆ TEN PLIK";
    const original = fs.readFileSync(file, "utf8");
    const body = original.slice(original.indexOf(heading) + heading.length).split("\n## ")[0]!.trim().split("\n")[0]!;
    fs.writeFileSync(file, original.replace(heading, `<!-- lex:wykonuje-aplikacja: PROFIL -->\n${heading}`));
    const registry = new LexSkillRegistry(root);
    registry.scan();
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sections",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Art. 286 KK — oszustwo." };
      }
    });
    await new SafeSessionExecutor(registry, new ProviderGateway(providers)).execute({
      query: "Czy to oszustwo z art. 286 KK?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    });
    const prompt = calls[0]!.systemPrompt ?? "";
    expect(prompt).toContain(`${heading} [wykonuje aplikacja: PROFIL]`);
    if (body.length > 20) expect(prompt).not.toContain(body);
    fs.rmSync(root, { recursive: true, force: true });
  }, 120_000);
});
