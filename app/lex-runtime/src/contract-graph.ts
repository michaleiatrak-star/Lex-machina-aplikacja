// The graph of a delivered agreement's provisions, read mechanically from its words before the
// model runs: who each numbered point binds, in whose favour, what it sanctions or waives, and
// the relations between points (a reference, a sanction, a waiver that cancels another point's
// right, two sanctions on the same conduct, an obligation left without a sanction). It is a
// skeleton the model confirms or corrects (analizator-umow-v1 CAL-GATE), not a legal finding:
// an 11B model read pkt 5 and pkt 10 apart until the relation was put in front of it (user
// report 2026-11-06).

export type ContractNode = {
  unit: string;
  text: string;
  bound: string[];
  favour: string[];
  kinds: Array<"OBOWIĄZEK" | "PRAWO" | "KARA" | "ZRZECZENIE" | "OŚWIADCZENIE">;
  references: string[];
  topics: string[];
};

export type ContractEdge = {
  from: string;
  to: string;
  relation: "ODSYŁA" | "SANKCJONUJE" | "ZNOSI PRAWO" | "PODWÓJNA SANKCJA" | "ASYMETRIA";
  note: string;
};

export type ContractGraph = { parties: string[]; nodes: ContractNode[]; edges: ContractEdge[] };

const BOTH = "obie strony";

// Subjects two points can share: a sanction on one of them is a sanction on the same conduct.
const TOPICS: Array<[string, RegExp]> = [
  ["poufność", /poufno\p{L}*|tajemnic\p{L}*|ujawni\p{L}*/iu],
  ["konkurencja", /konkurencj\p{L}*|nakłani\p{L}*|rozpowszechni\p{L}*/iu],
  ["wynagrodzenie", /wynagrodzeni\p{L}*|odpraw\p{L}*|ekwiwalent\p{L}*|premi\p{L}*/iu],
  ["roszczenia", /roszcze\p{L}*/iu],
  ["odpowiedzialność", /odpowiedzialno\p{L}*|szkod\p{L}*/iu],
  ["termin", /termin\p{L}*|z dniem|do dnia/iu]
];

const stem = (word: string) => word.toLocaleLowerCase("pl").slice(0, Math.max(5, word.length - 3));

/** The parties' role names ("zwaną dalej „Pracodawcą”"), in the nominative where the text gives it. */
export function contractParties(text: string): string[] {
  // A party is defined outside brackets ("…, zwaną dalej „Pracodawcą”,"); "(zwane dalej
  // „Informacjami”)" defines a term, not a party.
  const names = [...text.matchAll(/zwan\p{L}*\s+dalej\s+[„"»]?([\p{Lu}][\p{L}]+)[”"«]?/gu)]
    .filter((match) => !/\([^()]{0,20}$/u.test(text.slice(Math.max(0, match.index! - 20), match.index!)))
    .map((match) => match[1]!);
  // "Pracodawcą" → Pracodawca, "Pracownikiem" → Pracownik, "Wynajmującym" → Wynajmujący.
  const nominative = (name: string) => name.replace(/cym$/u, "cy").replace(/(?:ą|iem|em)$/u, (ending) => (ending === "ą" ? "a" : ""));
  return [...new Set(names.map(nominative))];
}

/** Numbered points ("5.", "12.W", "§ 4") of the document, each with its text up to the next. */
export function contractUnits(text: string): Array<{ unit: string; text: string }> {
  const heads = [...text.matchAll(/(?:^|\n)[ \t]*(§[ \t]*\d{1,3}|\d{1,3})[ \t]*[.)]?(?!\d)(?=[ \t]*\p{Lu}|[ \t]*[„"(]|[ \t]+\p{Ll})/gu)];
  const units: Array<{ unit: string; text: string }> = [];
  let expected = 1;
  for (let index = 0; index < heads.length; index += 1) {
    const head = heads[index]!;
    const label = head[1]!.replace(/\s+/gu, " ");
    const number = Number(label.replace(/\D/gu, ""));
    // A numbered list runs 1, 2, 3…: an amount or a year at the start of a line is no point.
    if (!label.startsWith("§") && number !== expected) continue;
    if (!label.startsWith("§")) expected += 1;
    const start = head.index! + head[0].length;
    const next = heads.slice(index + 1).find((other) => {
      const value = Number(other[1]!.replace(/\D/gu, ""));
      return other[1]!.startsWith("§") === label.startsWith("§") && value === number + 1;
    });
    units.push({ unit: label.startsWith("§") ? label : `pkt ${number}`, text: text.slice(start, next ? next.index : undefined).replace(/\s+/gu, " ").trim() });
  }
  return units;
}

function mentioned(text: string, party: string): number {
  const match = new RegExp(`(?<![\\p{L}])${stem(party)}\\p{L}*`, "iu").exec(text);
  return match ? match.index : -1;
}

function node(unit: { unit: string; text: string }, parties: string[]): ContractNode {
  const text = unit.text;
  const kinds: ContractNode["kinds"] = [];
  const bound = new Set<string>();
  const favour = new Set<string>();
  const both = /każd\p{L}*\s+ze\s+stron|\bStron\p{L}*\s+(?:wspólnie|zgodnie|zobowiązuj)/iu.test(text);
  // The party before the first verb of obligation is the one bound.
  const verb = /zobowiąz\p{L}*|zapłac\p{L}*|zapłaty|wypłac\p{L}*|odda\p{L}*|płaci\p{L}*|zachowa\p{L}*|zrzeka\p{L}*|oświadcza\p{L}*|ponosi|zwalnia\p{L}*|nie\s+może/iu.exec(text);
  const before = verb ? text.slice(0, verb.index) : text;
  const subject = parties
    .map((party) => ({ party, at: mentioned(before, party) }))
    .filter((item) => item.at >= 0)
    .sort((left, right) => right.at - left.at)[0]?.party;
  const other = (party: string) => parties.filter((item) => item !== party);
  if (both) bound.add(BOTH);
  else if (subject) bound.add(subject);
  if (/zrzeka\p{L}*\s+się|zrzec\p{L}*\s+się/iu.test(text)) kinds.push("ZRZECZENIE");
  if (/kar\p{L}*\s+(?:umown\p{L}*\s+)?(?:w\s+(?:kwocie|wysokości))|zapłaty\s+kary/iu.test(text)) {
    kinds.push("KARA");
    if (both) favour.add(BOTH);
    else if (subject) for (const party of other(subject)) favour.add(party);
  }
  if (/z\s+zachowaniem\s+prawa\s+do\s+wynagrodzenia|wypłac\p{L}*|odpraw\p{L}*|ekwiwalent\p{L}*|należn\p{L}*\s+(?:pracownikowi|najemcy|zleceniobiorcy|wykonawcy)/iu.test(text)) {
    kinds.push("PRAWO");
    // "Pracodawca zwalnia Pracownika … z zachowaniem prawa do wynagrodzenia": in favour of the other.
    if (subject) for (const party of other(subject)) favour.add(party);
  }
  if (/oświadcza\p{L}*/iu.test(text) && !kinds.length) kinds.push("OŚWIADCZENIE");
  if (/zobowiąz\p{L}*|zachowa\p{L}*\s+w\s+(?:ścisłej\s+)?tajemnicy|nie\s+może|do\s+nienaruszania|nienakłaniania|nierozpowszechniania/iu.test(text) && !kinds.includes("KARA")) kinds.push("OBOWIĄZEK");
  const references = [...text.matchAll(/(§\s*|zapis\p{L}*\s+(?:nr\s*)?|ust\.\s*|pkt\.?\s*|punkt\p{L}*\s+)(\d{1,3}(?:\s*(?:,|i|oraz)\s*\d{1,3})*)/giu)]
    .filter((match) => !/\bart\.\s*\d+[^.;]{0,20}$/u.test(text.slice(Math.max(0, match.index! - 25), match.index!)))
    .flatMap((match) => [...match[2]!.matchAll(/\d{1,3}/gu)].map((item) => (match[1]!.startsWith("§") ? `§ ${item[0]}` : `pkt ${item[0]}`)));
  const topics = TOPICS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return { unit: unit.unit, text, bound: [...bound], favour: [...favour], kinds, references: [...new Set(references)].filter((item) => item !== unit.unit), topics };
}

export function contractGraph(text: string): ContractGraph | null {
  const parties = contractParties(text);
  const units = contractUnits(text);
  if (units.length < 3 || parties.length < 2) return null;
  const nodes = units.map((unit) => node(unit, parties));
  const byUnit = new Map(nodes.map((item) => [item.unit, item]));
  const edges: ContractEdge[] = [];
  const holds = (item: ContractNode, party: string) => item.favour.includes(party) || item.favour.includes(BOTH);
  for (const [index, item] of nodes.entries()) {
    for (const target of item.references) if (byUnit.has(target)) edges.push({ from: item.unit, to: target, relation: item.kinds.includes("KARA") ? "SANKCJONUJE" : "ODSYŁA", note: "" });
    // "Za każde nieuprawnione naruszenie …" with no number: the point before it.
    if (item.kinds.includes("KARA") && !item.references.length && index > 0) {
      edges.push({ from: item.unit, to: nodes[index - 1]!.unit, relation: "SANKCJONUJE", note: "kara bez odesłania — dotyczy punktu poprzedzającego (do potwierdzenia)" });
    }
    if (item.kinds.includes("ZRZECZENIE")) {
      const waiving = item.bound.filter((party) => party !== BOTH);
      for (const party of waiving) {
        for (const target of nodes) {
          if (target === item || !holds(target, party)) continue;
          edges.push({
            from: item.unit,
            to: target.unit,
            relation: "ZNOSI PRAWO",
            note: `${party} zrzeka się roszczeń, a ${target.unit} daje tej stronie ${target.kinds.includes("KARA") ? "roszczenie o karę" : "świadczenie"}: sprzeczność albo zrzeczenie nie obejmuje roszczeń z tego dokumentu`
          });
        }
      }
    }
  }
  // Two sanctions on points of the same subject: which applies, cumulation, moderation.
  const sanctioned = new Map<string, string[]>();
  for (const edge of edges) if (edge.relation === "SANKCJONUJE") sanctioned.set(edge.from, [...(sanctioned.get(edge.from) ?? []), edge.to]);
  const subjects = (sanction: string) => new Set((sanctioned.get(sanction) ?? []).flatMap((unit) => byUnit.get(unit)?.topics ?? []).filter((topic) => topic !== "termin" && topic !== "odpowiedzialność" && topic !== "roszczenia"));
  const sanctions = [...sanctioned.keys()];
  for (let left = 0; left < sanctions.length; left += 1) {
    for (let right = left + 1; right < sanctions.length; right += 1) {
      const shared = [...subjects(sanctions[left]!)].filter((topic) => subjects(sanctions[right]!).has(topic));
      if (shared.length) edges.push({ from: sanctions[left]!, to: sanctions[right]!, relation: "PODWÓJNA SANKCJA", note: `ten sam przedmiot (${shared.join(", ")}): która kara, czy kumulacja, miarkowanie` });
    }
  }
  // An obligation of one party sanctioned, the same party's counterpart's obligations not.
  const sanctionedUnits = new Set([...sanctioned.values()].flat());
  for (const party of parties) {
    const own = nodes.filter((item) => item.kinds.includes("OBOWIĄZEK") && item.bound.includes(party));
    const unsanctioned = own.filter((item) => !sanctionedUnits.has(item.unit));
    const others = nodes.filter((item) => item.kinds.includes("OBOWIĄZEK") && !item.bound.includes(party) && !item.bound.includes(BOTH) && sanctionedUnits.has(item.unit));
    if (unsanctioned.length && others.length) {
      edges.push({ from: unsanctioned.map((item) => item.unit).join(", "), to: others.map((item) => item.unit).join(", "), relation: "ASYMETRIA", note: `obowiązki: ${party} bez sankcji, druga strona z karą` });
    }
  }
  return { parties, nodes, edges };
}

/** The graph as the model reads it: nodes, edges and each party's balance. */
export function contractGraphPrompt(graph: ContractGraph): string {
  const cell = (value: string) => value.replace(/\|/gu, "/");
  const lines = [
    "# GRAF RELACJI POSTANOWIEŃ (aplikacja — szkielet z brzmienia dokumentu, do potwierdzenia)",
    `Strony: ${graph.parties.join(", ")}. Szkielet wyprowadzony mechanicznie ze słów dokumentu: każdą krawędź potwierdź albo skoryguj w sekcji „Relacje między postanowieniami” (CAL-GATE); relacje, których słowa nie zdradzają (uzupełnienie, wyjątek, warunek), dodaj sam.`,
    "",
    "| Pkt | Wiąże | Na rzecz | Rodzaj | Przedmiot |",
    "|---|---|---|---|---|",
    ...graph.nodes.map((item) => `| ${item.unit} | ${item.bound.join(", ") || "—"} | ${item.favour.join(", ") || "—"} | ${item.kinds.join(", ") || "—"} | ${cell(item.topics.join(", ") || "—")} |`),
    "",
    "| Od | Relacja | Do | Uwaga |",
    "|---|---|---|---|",
    ...graph.edges.map((edge) => `| ${edge.from} | ${edge.relation} | ${edge.to} | ${cell(edge.note) || "—"} |`)
  ];
  for (const party of graph.parties) {
    const binds = graph.nodes.filter((item) => item.bound.includes(party) || item.bound.includes(BOTH)).map((item) => item.unit);
    const gives = graph.nodes.filter((item) => item.favour.includes(party) || item.favour.includes(BOTH)).map((item) => item.unit);
    lines.push(`Bilans — ${party}: obowiązki ${binds.join(", ") || "brak"}; prawa i roszczenia ${gives.join(", ") || "brak"}.`);
  }
  return lines.join("\n");
}
