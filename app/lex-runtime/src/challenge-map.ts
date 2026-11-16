// A challenge answers the decision challenged (RD 121/26, 2026-11-16): the application's draft
// added arguments outside the subject of the proceedings (the employment dispute, art. 25¹ KP;
// § 23e KEA on AI) while the chat answered the decision's own reasons one by one. The decision's
// theses are taken from its reasoning and every ground of the challenge is tied to one of them.
import { issueStems } from "./courts/wsd-topics.js";

export type ChallengeThesis = { text: string };

const CHALLENGE = /podważ|zaskarż|zażaleni|zażalenie|odwołani|odwołanie|apelacj|skarg\p{L}*\s+kasacyjn|sprzeciw|zarzut\p{L}*\s+od|uchyleni/iu;

// Words with which a decision states its findings and reasons.
const REASONING =
  /\b(?:nie\s+zachodzi|nie\s+stanowi|nie\s+można|nie\s+sposób|brak\s+(?:jest|podstaw|dowodów)|należy\s+uznać|uznać\s+należy|w\s+ocenie|ocena\s+ta|nie\s+wskazuje|nie\s+świadczy|wobec\s+powyższego|z\s+tych\s+względów|nie\s+budzi\s+wątpliwości|nie\s+zawiera|pełni\s+funkcję|służy\s+(?:natomiast|wyłącznie|jedynie)|nie\s+ma\s+podstaw|nie\s+wynika|nie\s+zapowiada|nie\s+narusza|mieści\s+się|nie\s+przekracza|chroni\s+przed|dotyczy\s+wyłącznie|pozbawione|zasadnie|niezasadn\p{L}*|bezzasadn\p{L}*)/iu;

export function isChallenge(question: string): boolean {
  return CHALLENGE.test(question);
}

/** The decision the question challenges: of the decisions in the files, the one whose heading the question names best. */
export function challengedDecision<T extends { documentId: string; text: string }>(decisions: readonly T[], question: string): T | null {
  if (!decisions.length) return null;
  const asked = issueStems(question);
  const scored = decisions.map((decision) => ({ decision, hit: [...issueStems(decision.text.slice(0, 2_000))].filter((stem) => asked.has(stem)).length }));
  return scored.sort((a, b) => b.hit - a.hit)[0]!.decision;
}

/** The theses of a decision's reasoning: its sentences that state a finding or a reason (at most `limit`). */
export function decisionTheses(text: string, limit = 10): ChallengeThesis[] {
  const reasons = /UZASADNIENIE/u.exec(text);
  // Abbreviations do not end a sentence ("z art. 17 § 1 pkt 2 k.p.k.", "ust. 4", "r.").
  const body = (reasons ? text.slice(reasons.index) : text)
    .replace(/\s*\n\s*/gu, " ")
    // Code names keep their dots inside ("k.p.k." followed by a lower-case word goes on).
    .replace(/\b(?:k\.p\.k|k\.p\.c|k\.p\.a|k\.k\.w|k\.k|k\.c|k\.p|Dz\.\s?U)\.(?=\s*[\p{Ll}\d§,;)])/gu, (match) => match.replace(/\./gu, "\u2024"))
    .replace(/\b(?:k\.p\.k|k\.p\.c|k\.p\.a|k\.k\.w|k\.k|k\.c|k\.p|Dz\.\s?U)(?=\.)/gu, (match) => match.replace(/\./gu, "\u2024"))
    .replace(/\b(art|ust|pkt|lit|zd|par|nr|poz|tj|tzw|np|ww|r|sygn|adw|ul|tel|zob|por)\.(?=\s*[\p{Ll}\d§])/gu, "$1\u2024");
  const sentences = (body.match(/[^.!?]{15,}(?:[.!?]+|$)/gu) ?? []).map((sentence) => sentence.replace(/\u2024/gu, "."));
  const seen = new Set<string>();
  const theses: ChallengeThesis[] = [];
  for (const sentence of sentences) {
    const clean = sentence.replace(/\s+/gu, " ").trim();
    // The instruction on the remedy is not a reason of the decision.
    if (!REASONING.test(clean) || /pouczeni|od\s+niniejszego\s+postanowienia|należy\s+złożyć\s+w\s+\d|egzemplarz/iu.test(clean)) continue;
    const key = clean.slice(0, 80).toLocaleLowerCase("pl");
    if (seen.has(key)) continue;
    seen.add(key);
    theses.push({ text: clean.slice(0, 400) });
    if (theses.length >= limit) break;
  }
  return theses;
}

export function challengeMapPrompt(decision: { documentId: string; label: string }, theses: readonly ChallengeThesis[]): string {
  if (!theses.length) return "";
  return [
    "# MAPA ZARZUTÓW — TEZY ZASKARŻONEGO ROZSTRZYGNIĘCIA (ustalone przez aplikację)",
    `Zaskarżane: ${decision.label} (${decision.documentId}). Tezy jego uzasadnienia, które środek zaskarżenia ma odeprzeć:`,
    ...theses.map((thesis, index) => `T${index + 1}. „${thesis.text}”`),
    "Zasady: (1) każdy zarzut wskazuje, którą tezę (T1…) odpiera albo jaką wadę postępowania organu wykazuje; (2) okoliczności spoza przedmiotu tego postępowania (inny spór stron, sprawy pracownicze, korzystanie z narzędzi) — najwyżej jedno zdanie kontekstu, nigdy osobny zarzut; (3) najsilniejszy zarzut pierwszy; (4) na końcu projektu, poza pismem, wypisz tezy bez odpowiedzi i powód (np. teza trafna albo brak materiału)."
  ].join("\n");
}
