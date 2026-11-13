import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendDraftVersion,
  draftPrompt,
  emptyProcessPleadingDraft,
  extractPleadingText,
  withDraftRemarks,
  withoutDraftRemarks
} from "../src/process-pleading-draft.js";
import {
  acceptProcessPleadingStart,
  createProcessPleadingState,
  markProcessCheckpointReady,
  nextRequiredProcessCheckpoint,
  reopenProcessPleadingDraft,
  requestProcessCheckpointRevision
} from "../src/process-pleading-state.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CASE = "case_" + "a".repeat(32);
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

describe("pleading draft between the pipeline's stages", () => {
  it("takes the pleading block of an answer and keeps versions", () => {
    const answer = "Raport\n=== PISMO ===\nSąd Rejonowy w Krakowie. Pozew o zapłatę kwoty 10 000 zł.\n=== KONIEC PISMA ===\nRejestr";
    const text = extractPleadingText(answer)!;
    expect(text).toBe("Sąd Rejonowy w Krakowie. Pozew o zapłatę kwoty 10 000 zł.");
    expect(extractPleadingText("Raport bez bloku pisma")).toBeNull();

    let draft = appendDraftVersion(emptyProcessPleadingDraft(CASE), { text, source: "PIPELINE", stage: "W2", checkpoint: "CP-ATAK" });
    draft = appendDraftVersion(draft, { text, source: "PIPELINE", stage: "W3", checkpoint: "CP-PODMIOT" });
    expect(draft.versions).toHaveLength(1);
    draft = appendDraftVersion(draft, { text: text + " Poprawka.", source: "USER", stage: "W3", change: "MINOR" });
    expect(draft.versions.map((item) => item.version)).toEqual([1, 2]);

    draft = withDraftRemarks(draft, "CP-QUALITY", "Dodaj zarzut przedawnienia.");
    expect(draft.remarks?.checkpoint).toBe("CP-QUALITY");
    expect(withoutDraftRemarks(draft).remarks).toBeUndefined();
  });

  it("tells the model where the pleading goes, which version it works on and the remarks", () => {
    const prompt = draftPrompt({
      checkpoint: "CP-QUALITY",
      draft: { version: 3, text: "TEKST", source: "USER", stage: "W3", createdAt: "" },
      remarks: "Zmień kwotę."
    });
    expect(prompt).toContain("=== PISMO ===");
    expect(prompt).toContain("wersja 3");
    expect(prompt).toContain("nie cofaj ich");
    expect(prompt).toContain("Zmień kwotę.");
    expect(draftPrompt({ checkpoint: "CP-1a", draft: null })).toBe("");
  });
});

describe("pleading pipeline: remarks and reopening (§7.2)", () => {
  function inStage(target: string) {
    let state = acceptProcessPleadingStart(createProcessPleadingState(CASE, "AUTO"));
    while (state.stage !== target) state = markProcessCheckpointReady(state, nextRequiredProcessCheckpoint(state)!);
    return state;
  }

  it("a substantive change after FINAL reopens CP-ATAK and the W3 checks", () => {
    const reopened = reopenProcessPleadingDraft(inStage("FINAL"), "zmiana żądania");
    expect(reopened).toMatchObject({ stage: "W2", documentStatus: "DRAFT", pendingCheckpoint: null });
    expect(nextRequiredProcessCheckpoint(reopened)).toBe("CP-ATAK");
    expect(reopened.checkpoints["CP-PODMIOT"]).toBe("CLOSED");
    expect(() => reopenProcessPleadingDraft(inStage("PRE_W2"), "x")).toThrow("PROCESS_PLEADING_REOPEN_INVALID");
  });

  it("a pending step goes back to OPEN only in CHECKPOINT mode", () => {
    let state = acceptProcessPleadingStart(createProcessPleadingState(CASE, "CHECKPOINT"));
    state = markProcessCheckpointReady(state, nextRequiredProcessCheckpoint(state)!);
    const pending = state.pendingCheckpoint!;
    const revised = requestProcessCheckpointRevision(state, pending);
    expect(revised.checkpoints[pending]).toBe("OPEN");
    expect(nextRequiredProcessCheckpoint(revised)).toBe(pending);
    expect(() => requestProcessCheckpointRevision(revised, pending)).toThrow("PROCESS_PLEADING_REVISION_INVALID");
  });
});

describe("stored draft reaches the model pseudonymized", () => {
  it("does not send personal data of the draft or remarks in clear", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const sent: string[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "test",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(request) {
        sent.push(JSON.stringify(request));
        return { fullText: "Raport CP-QUALITY." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    await executor.execute({
      query: "Przygotuj pismo procesowe.",
      provider: "openai",
      model: "gpt-test",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "PRAWNIK",
      processWorkflowContext: {
        stage: "W3",
        checkpoint: "CP-QUALITY",
        mode: "AUTO",
        draft: {
          version: 2,
          source: "USER",
          stage: "W3",
          text: "Powód Jan Kowalski, PESEL 44051401359, wnosi o zasądzenie 10 000 zł."
        },
        remarks: "Popraw PESEL 44051401359 w komparycji."
      }
    } as never).catch(() => undefined);
    expect(sent.length).toBeGreaterThan(0);
    const all = sent.join("\n");
    expect(all).toContain("AKTUALNY PROJEKT PISMA");
    expect(all).not.toContain("44051401359");
  });
});

describe("evidence inventory of the whole case file (matrix step)", () => {
  it("reads every chunk in portions, keeps the inventory and gives the step its view", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const sent: Array<{ system: string; body: string }> = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "test",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(request) {
        const body = JSON.stringify(request);
        sent.push({ system: request.systemPrompt, body });
        if (request.systemPrompt.startsWith("Jesteś asystentem prawnika. Poniżej fragmenty akt")) {
          const user = String(request.messages.at(-1)?.content ?? "");
          return {
            fullText: [...user.matchAll(/\[FRAGMENT (F\d+) — dokument [^\]]+\]\n(.+)/gu)].map((match) => `${match[1]} | Fakt: ${match[2]!.slice(0, 30)} | ${match[2]!.slice(0, 40)} | dokument prywatny | B | -`).join("\n")
          };
        }
        return { fullText: "MACIERZ D×T: D1 → T1." };
      }
    });
    const pages: Record<string, string[]> = {
      "doc-umowa": ["Strony zawarły umowę sprzedaży w dniu 1 marca 2024 r. w Krakowie.", "Cena wynosi 10 000 zł i jest płatna w terminie 14 dni."],
      "doc-wezwanie": ["Wezwanie do zapłaty z dnia 20 kwietnia 2024 r. doręczone pozwanemu."]
    };
    const saved: unknown[] = [];
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    await executor.execute({
      query: "Przygotuj pismo procesowe.",
      provider: "openai",
      model: "gpt-test",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "PRAWNIK",
      caseFiles: {
        caseId: CASE,
        listDocuments: async () => Object.entries(pages).map(([documentId, chunks]) => ({ documentId, totalPages: chunks.length, chunks: chunks.length })),
        search: async () => [],
        readChunks: async (documentId: string, indices: number[]) => ({
          totalPages: pages[documentId]!.length,
          chunks: indices.map((index) => ({ index, pageStart: index + 1, pageEnd: index + 1, text: pages[documentId]![index]! }))
        }),
        sharedKey: () => false
      },
      processWorkflowContext: {
        stage: "W1",
        checkpoint: "CP-1c-macierz",
        mode: "AUTO",
        saveEvidence: async (inventory: unknown) => {
          saved.push(inventory);
        }
      }
    } as never).catch(() => undefined);
    const extraction = sent.filter((item) => item.system.startsWith("Jesteś asystentem prawnika. Poniżej fragmenty akt"));
    expect(extraction).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect((saved[0] as { items: Array<{ id: string; documentId: string; quoteVerified: boolean }> }).items.map((item) => [item.id, item.documentId, item.quoteVerified])).toEqual([
      ["D1", "doc-umowa", true],
      ["D2", "doc-umowa", true],
      ["D3", "doc-wezwanie", true]
    ]);
    const main = sent.find((item) => item.body.includes("INWENTARZ DOWODÓW Z CAŁYCH AKT SPRAWY"));
    expect(main?.body).toContain("D3 [B; dokument prywatny; dok. doc-wezwanie, s. 1]");
  });
});
