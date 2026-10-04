// Kind of a document the user sent (court decision, pleading, contract, evidence...),
// recognised locally from its (pseudonymized) text and images before the model
// runs. The router chooses the skill also by what the user delivers
// (shared/ACTIVATION-MATRIX.md: "dostarcza akta / wyrok / pismo przeciwnika",
// "dostarcza dowody bez pisma"), so the application has to know it.

export type DocumentCategory =
  | "ORZECZENIE"
  | "PISMO_PROCESOWE"
  | "KORESPONDENCJA"
  | "UMOWA"
  | "DOWOD"
  | "MATERIAL_PRAWNY"
  | "INNE";

export type DocumentKind = {
  kind: string;
  label: string;
  category: DocumentCategory;
  evidence: boolean;
  signals: string[];
};

type Rule = { kind: string; label: string; category: DocumentCategory; evidence: boolean; patterns: RegExp[]; minHits?: number };

// Ordered from the most specific; the head of the document weighs most.
const RULES: Rule[] = [
  { kind: "NAKAZ_ZAPLATY", label: "nakaz zapłaty", category: "ORZECZENIE", evidence: false, patterns: [/\bnakaz\s+zapłaty\b/iu] },
  { kind: "WYROK", label: "wyrok", category: "ORZECZENIE", evidence: false, patterns: [/(?:^|\n)\s*W\s?Y\s?R\s?O\s?K\b/u, /w\s+imieniu\s+rzeczypospolitej\s+polskiej/iu, /\bsygn\.\s*akt\b/iu], minHits: 2 },
  { kind: "POSTANOWIENIE", label: "postanowienie", category: "ORZECZENIE", evidence: false, patterns: [/(?:^|\n)\s*POSTANOWIENIE\b/u, /\bsygn\.\s*akt\b/iu, /\bpostanawia\b/iu], minHits: 2 },
  { kind: "DECYZJA", label: "decyzja administracyjna", category: "ORZECZENIE", evidence: false, patterns: [/(?:^|\n)\s*DECYZJA\b/u, /\bna\s+podstawie\s+art\.\s*\d+[\s\S]{0,80}(?:k\.p\.a|kodeksu\s+postępowania\s+administracyjnego|ordynacji\s+podatkowej)/iu, /\bpouczenie\b/iu], minHits: 2 },
  { kind: "AKT_OSKARZENIA", label: "akt oskarżenia", category: "PISMO_PROCESOWE", evidence: false, patterns: [/\bakt\s+oskarżenia\b/iu] },
  { kind: "APELACJA", label: "apelacja", category: "PISMO_PROCESOWE", evidence: false, patterns: [/(?:^|\n)\s*APELACJA\b/u, /\bwnoszę\s+apelację\b/iu] },
  { kind: "ZAZALENIE", label: "zażalenie", category: "PISMO_PROCESOWE", evidence: false, patterns: [/(?:^|\n)\s*ZAŻALENIE\b/u, /\bwnoszę\s+zażalenie\b/iu] },
  { kind: "SPRZECIW", label: "sprzeciw / zarzuty", category: "PISMO_PROCESOWE", evidence: false, patterns: [/(?:^|\n)\s*SPRZECIW\b/u, /\bwnoszę\s+sprzeciw\b/iu, /\bzarzuty\s+od\s+nakazu\b/iu] },
  { kind: "ODPOWIEDZ_NA_POZEW", label: "odpowiedź na pozew", category: "PISMO_PROCESOWE", evidence: false, patterns: [/\bodpowiedź\s+na\s+pozew\b/iu] },
  { kind: "POZEW", label: "pozew", category: "PISMO_PROCESOWE", evidence: false, patterns: [/(?:^|\n)\s*POZEW\b/u, /\bpozew\s+o\s+\p{L}+/iu, /\bwartość\s+przedmiotu\s+sporu\b/iu] },
  { kind: "SKARGA", label: "skarga", category: "PISMO_PROCESOWE", evidence: false, patterns: [/(?:^|\n)\s*SKARGA\b/u, /\bwnoszę\s+skargę\b/iu] },
  { kind: "WNIOSEK", label: "wniosek / pismo procesowe", category: "PISMO_PROCESOWE", evidence: false, patterns: [/(?:^|\n)\s*(?:WNIOSEK|PISMO\s+PROCESOWE)\b/u, /\bwnoszę\s+o\b/iu], minHits: 2 },
  { kind: "WEZWANIE", label: "wezwanie", category: "KORESPONDENCJA", evidence: true, patterns: [/\b(?:przedsądowe\s+)?wezwanie\s+do\s+(?:zapłaty|wydania|usunięcia|zaniechania)\b/iu, /(?:^|\n)\s*WEZWANIE\b/u] },
  { kind: "REGULAMIN", label: "regulamin", category: "UMOWA", evidence: false, patterns: [/(?:^|\n)\s*REGULAMIN\b/u, /\bregulamin\s+(?:świadczenia|sklepu|serwisu|pracy|wynagradzania)\b/iu] },
  { kind: "UMOWA", label: "umowa", category: "UMOWA", evidence: false, patterns: [/(?:^|\n)\s*UMOWA\b/u, /\bzawarta\s+w\s+dniu\b/iu, /\bstrony\s+(?:zgodnie\s+)?postanawiają\b|\bstrony\s+ustalają\b/iu, /§\s*1\b/u], minHits: 2 },
  { kind: "OPINIA_BIEGLEGO", label: "opinia biegłego", category: "DOWOD", evidence: true, patterns: [/\bopinia\s+biegłego\b/iu, /\bbiegł\p{L}+\s+sądow\p{L}+/iu] },
  { kind: "PROTOKOL", label: "protokół", category: "DOWOD", evidence: true, patterns: [/(?:^|\n)\s*PROTOKÓŁ\b/u, /\bprotokół\s+(?:rozprawy|przesłuchania|posiedzenia|odbioru|zdawczo|oględzin|zebrania)\b/iu] },
  { kind: "FAKTURA", label: "faktura / rachunek", category: "DOWOD", evidence: true, patterns: [/\bfaktura(?:\s+vat)?\b/iu, /\bsprzedawca\b[\s\S]{0,400}\bnabywca\b/iu, /\b(?:kwota|razem)\s+(?:brutto|do\s+zapłaty)\b/iu], minHits: 2 },
  { kind: "EMAIL", label: "wiadomość e-mail", category: "KORESPONDENCJA", evidence: true, patterns: [/(?:^|\n)\s*(?:Od|From)\s*:/u, /(?:^|\n)\s*(?:Do|To)\s*:/u, /(?:^|\n)\s*(?:Temat|Subject)\s*:/u], minHits: 2 },
  { kind: "KOMUNIKATOR", label: "SMS / komunikator", category: "KORESPONDENCJA", evidence: true, patterns: [/\b(?:SMS|WhatsApp|Messenger|Signal|Telegram)\b/u, /(?:\n.{0,40}\b\d{1,2}:\d{2}\b.*){4,}/u] },
  { kind: "ZASWIADCZENIE", label: "zaświadczenie / dokumentacja", category: "DOWOD", evidence: true, patterns: [/(?:^|\n)\s*ZAŚWIADCZENIE\b/u, /\b(?:karta\s+informacyjna|historia\s+choroby|epikryza)\b/iu] },
  { kind: "PELNOMOCNICTWO", label: "pełnomocnictwo", category: "INNE", evidence: false, patterns: [/(?:^|\n)\s*PEŁNOMOCNICTWO\b/u, /\budzielam\s+pełnomocnictwa\b/iu] },
  { kind: "OPINIA_PRAWNA", label: "cudza opinia / analiza prawna", category: "MATERIAL_PRAWNY", evidence: false, patterns: [/\bopinia\s+prawna\b/iu, /\bklucz\s+odpowiedzi\b/iu, /\banaliza\s+prawna\b/iu] }
];

const HEAD_CHARS = 6_000;

export function classifyDocument(input: { text: string; images?: number }): DocumentKind {
  const head = input.text.slice(0, HEAD_CHARS);
  const words = head.replace(/\[[^\]]+\]/g, " ").replace(/=== STRONA[^=]*===/g, " ").trim();
  // A photo or a scan without a text layer.
  if ((input.images ?? 0) > 0 && words.replace(/\s+/g, "").length < 200) {
    return { kind: "ZDJECIE", label: "zdjęcie / obraz", category: "DOWOD", evidence: true, signals: [`obrazy: ${input.images}`] };
  }
  for (const rule of RULES) {
    const hits = rule.patterns.flatMap((pattern) => {
      const match = pattern.exec(head);
      return match ? [match[0].trim().replace(/\s+/g, " ").slice(0, 40)] : [];
    });
    if (hits.length >= (rule.minHits ?? 1)) {
      return { kind: rule.kind, label: rule.label, category: rule.category, evidence: rule.evidence, signals: hits };
    }
  }
  return { kind: "INNE", label: "dokument (rodzaj nierozpoznany)", category: "INNE", evidence: false, signals: [] };
}

export type RecognisedDocument = DocumentKind & { documentId: string };

/** What the model is told about the materials, before it reads them. */
export function recognisedDocumentsPrompt(documents: RecognisedDocument[]): string {
  const evidence = documents.filter((document) => document.evidence).length;
  return [
    "# ROZPOZNANE MATERIAŁY (aplikacja, lokalnie z treści dokumentów)",
    ...documents.map(
      (document) =>
        `- ${document.documentId}: ${document.label}${document.evidence ? " — materiał dowodowy" : ""}${document.signals.length ? ` (sygnały: ${document.signals.map((signal) => `„${signal}”`).join(", ")})` : ""}`
    ),
    evidence ? `Materiałów dowodowych: ${evidence}. Każdy wymaga skanu kompletności i oceny (MOD-SKAN-DOWODOW-KOMPLETNY), nie tylko streszczenia.` : "",
    "Rozpoznanie jest wskazówką: gdy treść dokumentu przeczy rozpoznanemu rodzajowi, powiedz to wprost i postępuj według rzeczywistego rodzaju."
  ]
    .filter(Boolean)
    .join("\n");
}
