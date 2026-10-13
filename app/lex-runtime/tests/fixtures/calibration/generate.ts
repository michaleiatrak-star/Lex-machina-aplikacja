import { TOPICS, type Forum, type Topic } from "./topics.js";

// 1000 calibration cases for the cited-document check. Each case: a question, an answer that
// says something about one cited document, the document as a source tool returns it, and the
// label a careful reader gives after reading the whole text. What counts is the decision of
// the competent authority, never a party's argument, a rejected applicant's view or a dissent.

export type ClaimType =
  | "CORRECT" | "PARAPHRASE" | "REVERSED" | "PARTY_AS_HOLDING" | "DISSENT_AS_HOLDING" | "APPLICANT_REJECTED"
  | "APPLICANT_ADOPTED" | "OTHER_TOPIC" | "OVERSTATED" | "PARTIAL_CRITERION" | "PARTY_HONEST";
export type Encoding = "plain" | "ascii" | "nested" | "long" | "hitlist";
export type Expected = { topic: "MATCH" | "PARTIAL" | "NO_MATCH"; claim: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" };

export type CalibrationCase = {
  id: string;
  forum: Forum;
  topic: string;
  claimType: ClaimType;
  encoding: Encoding;
  question: string;
  answer: string;
  sources: string[];
  signature: string;
  expected: Expected;
  // The authority's holding as written in the document (it must reach the judge).
  decisive: string;
  // A party argument or dissent in the text that must not be read as the holding.
  trap: boolean;
};

const EXPECTED: Record<ClaimType, Expected> = {
  CORRECT: { topic: "MATCH", claim: "SUPPORTED" },
  PARAPHRASE: { topic: "MATCH", claim: "SUPPORTED" },
  PARTY_HONEST: { topic: "MATCH", claim: "SUPPORTED" },
  APPLICANT_ADOPTED: { topic: "MATCH", claim: "SUPPORTED" },
  REVERSED: { topic: "MATCH", claim: "UNSUPPORTED" },
  PARTY_AS_HOLDING: { topic: "MATCH", claim: "UNSUPPORTED" },
  DISSENT_AS_HOLDING: { topic: "MATCH", claim: "UNSUPPORTED" },
  APPLICANT_REJECTED: { topic: "MATCH", claim: "UNSUPPORTED" },
  OVERSTATED: { topic: "MATCH", claim: "PARTIAL" },
  PARTIAL_CRITERION: { topic: "PARTIAL", claim: "SUPPORTED" },
  OTHER_TOPIC: { topic: "NO_MATCH", claim: "UNSUPPORTED" }
};

// Deterministic PRNG (mulberry32).
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cap = (value: string) => value.charAt(0).toLocaleUpperCase("pl") + value.slice(1);

const FILLER = [
  "Sąd rozpoznał sprawę na rozprawie z udziałem stron.",
  "Środek zaskarżenia został wniesiony w terminie i spełnia wymogi formalne.",
  "Akta sprawy przekazano wraz z odpowiedzią na środek zaskarżenia.",
  "Postępowanie dowodowe przeprowadzono w zakresie wnioskowanym przez strony.",
  "Pełnomocnictwo zostało złożone wraz z pierwszym pismem w sprawie.",
  "Doręczenie odpisu nastąpiło za pośrednictwem operatora pocztowego.",
  "Stan faktyczny sprawy nie był między stronami sporny w istotnym zakresie.",
  "W toku postępowania przesłuchano świadków wskazanych przez strony.",
  "Sąd nie jest związany podstawą prawną wskazaną przez strony.",
  "Koszty postępowania rozstrzygnięto zgodnie z zasadą odpowiedzialności za wynik sprawy."
];
const filler = (r: () => number, sentences: number, tag: string) =>
  Array.from({ length: sentences }, (_, index) => `${FILLER[Math.floor(r() * FILLER.length)]} [${tag}${index}]`).join("\n");

const CITIES = ["Warszawie", "Krakowie", "Gdańsku", "Poznaniu", "Wrocławiu", "Łodzi", "Lublinie", "Białymstoku"];
const WSA_CODE: Record<string, string> = { Warszawie: "Wa", Krakowie: "Kr", Gdańsku: "Gd", Poznaniu: "Po", Wrocławiu: "Wr", Łodzi: "Łd", Lublinie: "Lu", Białymstoku: "Bk" };

function signatureFor(forum: Forum, n: number, r: () => number): { signature: string; label: string; court: string } {
  const year = 23 + (n % 3);
  const city = CITIES[n % CITIES.length]!;
  switch (forum) {
    case "SN": return { signature: `${["I", "II", "III", "IV", "V"][n % 5]} ${["CSKP", "KK", "PSKP", "CSK"][n % 4]} ${100 + n}/${year}`, label: "wyrok Sądu Najwyższego", court: "Sąd Najwyższy" };
    case "SN_UCHWALA": return { signature: `${["III", "I"][n % 2]} ${["CZP", "KZP"][n % 2]} ${10 + n}/${year}`, label: "uchwała składu siedmiu sędziów Sądu Najwyższego", court: "Sąd Najwyższy" };
    case "SA": return { signature: `${["I", "II"][n % 2]} ${["ACa", "AKa"][n % 2]} ${200 + n}/${year}`, label: `wyrok Sądu Apelacyjnego w ${city}`, court: "Sąd Apelacyjny" };
    case "SO": return { signature: `${["II", "III"][n % 2]} ${["Ca", "Ka", "RCa"][n % 3]} ${300 + n}/${year}`, label: `wyrok Sądu Okręgowego w ${city}`, court: "Sąd Okręgowy" };
    case "NSA": return { signature: `${["I", "II"][n % 2]} ${["OSK", "FSK", "GSK"][n % 3]} ${1000 + n}/${year}`, label: "wyrok Naczelnego Sądu Administracyjnego", court: "Naczelny Sąd Administracyjny" };
    case "WSA": return { signature: `${["I", "II", "III"][n % 3]} ${["SA", "SAB"][n % 2]}/${WSA_CODE[city]} ${400 + n}/${year}`, label: `wyrok Wojewódzkiego Sądu Administracyjnego w ${city}`, court: "Wojewódzki Sąd Administracyjny" };
    case "TK": return { signature: `${["K", "SK", "P"][n % 3]} ${n % 40 + 1}/${year}`, label: "wyrok Trybunału Konstytucyjnego", court: "Trybunał Konstytucyjny" };
    case "KIO": return { signature: `KIO ${1500 + n}/${year}`, label: "wyrok Krajowej Izby Odwoławczej", court: "Krajowa Izba Odwoławcza" };
    case "KIS": return { signature: `0114-KDIP${1 + (n % 4)}-${1 + (n % 3)}.40${10 + (n % 3)}.${100 + n}.20${year}.${1 + (n % 2)}.${["AB", "KP", "MW", "JKU"][n % 4]}`, label: "interpretacja indywidualna Dyrektora Krajowej Informacji Skarbowej", court: "Dyrektor KIS" };
    case "UODO": return { signature: `DKN.513${n % 3}.${10 + n}.20${year}`, label: "decyzja Prezesa Urzędu Ochrony Danych Osobowych", court: "Prezes UODO" };
    case "ETPC": return { signature: `${10000 + n * 7}/${(year - 4).toString().padStart(2, "0")}`, label: "wyrok Europejskiego Trybunału Praw Człowieka w sprawie ze skargi nr", court: "ETPC" };
    case "TSUE": return { signature: `C-${100 + n}/${year - 3}`, label: "wyrok Trybunału Sprawiedliwości UE w sprawie", court: "TSUE" };
    case "ELI": return { signature: "", label: "przepis", court: "" };
  }
  void r;
}

const ELI_CLAIM: Record<string, string> = { "eli-118": "art. 118 KC", "eli-415": "art. 415 KC", "eli-art30-kp": "art. 30 § 4 KP" };

// The document as the authority wrote it: the decision, a party's argument, sometimes a dissent.
function documentText(topic: Topic, forum: Forum, sig: { signature: string; label: string; court: string }, r: () => number, options: { long: boolean; dissent: boolean; applicantCorrect: boolean; partyAfter: boolean }): string {
  const pad = (tag: string) => filler(r, options.long ? 140 + Math.floor(r() * 80) : 3 + Math.floor(r() * 4), tag);
  const party = topic.party ? cap(topic.party) : "";
  const holding = cap(topic.holding);
  switch (forum) {
    case "KIS": {
      const verdict = options.applicantCorrect ? "prawidłowe" : "nieprawidłowe";
      const applicantView = options.applicantCorrect ? topic.holding : topic.party || topic.contrary;
      return [
        `INTERPRETACJA INDYWIDUALNA ${sig.signature}`,
        `Stanowisko, które przedstawił Pan we wniosku dotyczącym sprawy: ${topic.subject}, jest ${verdict}.`,
        "Opis stanu faktycznego",
        pad("k1"),
        `Stanowisko Wnioskodawcy: Wnioskodawca uważa, że ${applicantView}.`,
        pad("k2"),
        `Ocena stanowiska: ${holding}.`,
        pad("k3")
      ].join("\n");
    }
    case "UODO":
      return [
        `DECYZJA ${sig.signature}`,
        `Prezes Urzędu Ochrony Danych Osobowych po przeprowadzeniu postępowania w sprawie: ${topic.subject}.`,
        pad("u1"),
        party ? `Administrator wyjaśnił, że ${topic.party}.` : "",
        pad("u2"),
        `Prezes Urzędu uznał, że ${topic.holding}.`,
        "Nakłada na administratora administracyjną karę pieniężną.",
        pad("u3")
      ].filter(Boolean).join("\n");
    case "ETPC":
      return [
        `Wyrok w sprawie ze skargi nr ${sig.signature}`,
        pad("e1"),
        party ? `Rząd twierdził, że ${topic.party}.` : "",
        pad("e2"),
        `Trybunał stwierdza, że ${topic.holding}.`,
        pad("e3")
      ].filter(Boolean).join("\n");
    case "TSUE":
      return [
        `Wyrok Trybunału w sprawie ${sig.signature}`,
        pad("t1"),
        party ? `W postępowaniu głównym ${topic.party}.` : "",
        pad("t2"),
        `Z tych względów Trybunał orzeka: ${holding}.`,
        pad("t3")
      ].filter(Boolean).join("\n");
    case "TK":
      return [
        `Wyrok z dnia 12 marca 20${sig.signature.slice(-2)} r., sygn. akt ${sig.signature}`,
        `Trybunał Konstytucyjny orzeka: ${holding}.`,
        "Uzasadnienie",
        pad("tk1"),
        party ? `W piśmie procesowym ${topic.party}.` : "",
        pad("tk2"),
        `Trybunał Konstytucyjny stwierdza, że ${topic.holding}.`,
        pad("tk3"),
        ...(options.dissent ? ["Zdanie odrębne", `Sędzia TK nie zgadza się z wyrokiem: jego zdaniem ${topic.contrary}.`] : [])
      ].filter(Boolean).join("\n");
    case "KIO":
      return [
        `Wyrok Krajowej Izby Odwoławczej ${sig.signature}`,
        "Izba orzeka w przedmiocie odwołania.",
        pad("ki1"),
        `Odwołujący podnosił, że ${topic.party}.`,
        pad("ki2"),
        `Izba zważyła, co następuje. ${holding}.`,
        pad("ki3")
      ].join("\n");
    default: {
      const uchwala = forum === "SN_UCHWALA";
      const header = uchwala
        ? [`Uchwała składu siedmiu sędziów Sądu Najwyższego, sygn. ${sig.signature}`, "Teza", `${holding}.`]
        : [`${cap(sig.label)}, sygn. ${sig.signature}`, "Sentencja", `${sig.court} oddala środek zaskarżenia.`];
      const partyPart = party
        ? `${forum === "NSA" || forum === "WSA" ? "W skardze" : "W apelacji"} strona podniosła, że ${topic.party}.`
        : "";
      const courtPart = `${sig.court} zważył, co następuje. Zarzut ten nie jest zasadny. ${holding}.`;
      return [
        ...header,
        "Uzasadnienie",
        pad("c1"),
        ...(options.partyAfter ? [courtPart, pad("c2"), partyPart] : [partyPart, pad("c2"), courtPart]),
        pad("c3"),
        ...(options.dissent ? ["Zdanie odrębne", `Sędzia nie podziela stanowiska większości: jego zdaniem ${topic.contrary}.`] : [])
      ].filter(Boolean).join("\n");
    }
  }
}

const wrap = (forum: Forum, payload: Record<string, unknown>) => JSON.stringify({ source: forum.toLowerCase(), status: "OK", result: payload });
const asciiJson = (value: unknown) => JSON.stringify(value).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);

function claimTypesFor(topic: Topic, forum: Forum, dissent: boolean, applicantCorrect: boolean): ClaimType[] {
  if (forum === "ELI") return ["CORRECT", "PARAPHRASE", "REVERSED", "OVERSTATED", "OTHER_TOPIC"];
  const types: ClaimType[] = ["CORRECT", "PARAPHRASE", "REVERSED", "OVERSTATED", "OTHER_TOPIC", "PARTIAL_CRITERION"];
  if (forum === "KIS") types.push(...Array<ClaimType>(3).fill(applicantCorrect ? "APPLICANT_ADOPTED" : "APPLICANT_REJECTED"));
  else if (topic.party) types.push("PARTY_AS_HOLDING", "PARTY_HONEST", "PARTY_AS_HOLDING");
  if (dissent) types.push("DISSENT_AS_HOLDING", "DISSENT_AS_HOLDING", "DISSENT_AS_HOLDING", "DISSENT_AS_HOLDING");
  return types;
}

const OTHER_FORUM_NAME: Partial<Record<Forum, string>> = { WSA: "NSA", NSA: "WSA", SA: "Sądu Najwyższego", SO: "Sądu Najwyższego", SN: "Trybunału Konstytucyjnego", SN_UCHWALA: "Trybunału Konstytucyjnego", KIS: "NSA", UODO: "NSA", KIO: "Sądu Okręgowego", TK: "Sądu Najwyższego", ETPC: "TSUE", TSUE: "ETPC" };

export function generateCases(count = 1000, seed = 20261013): CalibrationCase[] {
  const r = rng(seed);
  const cases: CalibrationCase[] = [];
  for (let n = 0; n < count; n += 1) {
    const topic = TOPICS[n % TOPICS.length]!;
    const forum = topic.forums[Math.floor(r() * topic.forums.length)]!;
    const encodingRoll = r();
    const encoding: Encoding = forum === "ELI" ? "plain" : encodingRoll < 0.33 ? "plain" : encodingRoll < 0.48 ? "ascii" : encodingRoll < 0.63 ? "nested" : encodingRoll < 0.9 ? "long" : "hitlist";
    const dissent = (forum === "SN" || forum === "SN_UCHWALA" || forum === "TK") && r() < 0.45;
    const applicantCorrect = r() < 0.5;
    const types = claimTypesFor(topic, forum, dissent, applicantCorrect);
    const claimType = types[Math.floor(r() * types.length)]!;
    const sig = signatureFor(forum, n, r);
    const other = TOPICS[(n + 7 + Math.floor(r() * 10)) % TOPICS.length]!;
    const question = claimType === "OTHER_TOPIC" ? other.question : claimType === "PARTIAL_CRITERION" ? `${topic.question} Szukam orzeczenia ${OTHER_FORUM_NAME[forum] ?? "innego organu"}.` : topic.question;
    const who = forum === "KIS" ? `Interpretacja ${sig.signature}` : forum === "ETPC" ? `ETPC, skarga nr ${sig.signature}` : forum === "ELI" ? cap(ELI_CLAIM[topic.key]!) : `${cap(sig.label)}, sygn. ${sig.signature}`;
    const verb = forum === "KIS" ? "organ uznał, że" : forum === "ELI" ? "stanowi, że" : "rozstrzygnięto, że";
    const claimText: Record<ClaimType, string> = {
      CORRECT: `${verb} ${topic.holding}`,
      PARAPHRASE: `${verb} ${topic.paraphrase}`,
      REVERSED: `${verb} ${topic.contrary}`,
      PARTY_AS_HOLDING: `${verb} ${topic.party}`,
      DISSENT_AS_HOLDING: `${verb} ${topic.contrary}`,
      APPLICANT_REJECTED: `organ potwierdził stanowisko wnioskodawcy, że ${topic.party || topic.contrary}`,
      APPLICANT_ADOPTED: `organ potwierdził stanowisko wnioskodawcy, że ${topic.holding}`,
      OTHER_TOPIC: `${verb} ${other.holding}`,
      OVERSTATED: `${verb} ${topic.overstated}`,
      PARTIAL_CRITERION: `(to nie jest orzeczenie ${OTHER_FORUM_NAME[forum] ?? "wskazanego organu"}) ${verb} ${topic.paraphrase}`,
      PARTY_HONEST: `strona podnosiła, że ${topic.party}, ale ${forum === "KIO" ? "Izba" : "sąd"} to odrzucił i przyjął, że ${topic.paraphrase}`
    };
    const answer = `${who}: ${claimText[claimType]}.`;
    let sources: string[];
    if (forum === "ELI") {
      sources = [JSON.stringify({ claim: ELI_CLAIM[topic.key], status: "VERIFIED", evidence: cap(topic.holding) + "." })];
    } else {
      const text = documentText(topic, forum, sig, r, { long: encoding === "long", dissent, applicantCorrect, partyAfter: r() < 0.4 });
      const payload = { sygnatura: sig.signature, organ: sig.court, tresc: text };
      if (encoding === "ascii") sources = [asciiJson({ source: forum.toLowerCase(), status: "OK", result: payload })];
      else if (encoding === "nested") sources = [JSON.stringify({ source: forum.toLowerCase(), status: "OK", result: JSON.stringify(payload) })];
      else if (encoding === "hitlist") {
        const decoy = TOPICS[(n + 3) % TOPICS.length]!;
        const entry = (signature: string, subject: string, thesis: string) => ({ sygnatura: signature, naglowek: `${signature} - ${sig.label}`, przedmiot: subject, teza: thesis });
        sources = [wrap(forum, { wyniki: [
          entry(signatureFor(forum, n + 5000, r).signature, decoy.subject, cap(decoy.holding)),
          entry(sig.signature, topic.subject, `${holding(topic)}`),
          entry(signatureFor(forum, n + 7000, r).signature, decoy.subject, cap(decoy.contrary))
        ] })];
      } else sources = [wrap(forum, payload)];
    }
    // Hit lists carry only the thesis: party and dissent types make no sense there.
    const effectiveType: ClaimType = encoding === "hitlist" && ["PARTY_AS_HOLDING", "DISSENT_AS_HOLDING", "PARTY_HONEST", "APPLICANT_REJECTED", "APPLICANT_ADOPTED"].includes(claimType) ? "REVERSED" : claimType;
    const finalAnswer = effectiveType === claimType ? answer : `${who}: ${claimText.REVERSED}.`;
    cases.push({
      id: `C${String(n + 1).padStart(4, "0")}`,
      forum,
      topic: topic.key,
      claimType: effectiveType,
      encoding,
      question,
      answer: finalAnswer,
      sources,
      signature: forum === "ELI" ? cap(ELI_CLAIM[topic.key]!) : sig.signature,
      expected: EXPECTED[effectiveType],
      decisive: topic.holding,
      trap: encoding !== "hitlist" && forum !== "ELI" && (Boolean(topic.party) || dissent || (forum === "KIS" && !applicantCorrect))
    });
  }
  return cases;
}

function holding(topic: Topic): string {
  return cap(topic.holding);
}
