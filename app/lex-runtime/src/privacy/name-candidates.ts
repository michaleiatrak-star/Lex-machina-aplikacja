/**
 * Can this text hold a person's name or an address? Used only when every name
 * recognizer has failed: a text with no candidate (no capitalized word inside a
 * sentence other than an institution's, no all-caps word other than an acronym, no
 * street) goes on with the deterministic identifiers masked; one with a candidate is
 * blocked (fail closed). Deliberately broad: any unknown capitalized word counts.
 */

// Capitalized words of institutions, acts and courts (folded, start of word).
const INSTITUTION_STEMS = [
  "sad", "sedzi", "najwyzsz", "trybunal", "konstytuc", "naczeln", "administrac", "wojewodzk", "okregow", "rejonow", "apelacyj",
  "rzeczpospolit", "rzeczypospolit", "polsk", "polsc", "skarb", "panstw", "urzad", "urzed", "prokurat", "polic", "rzeczni",
  "praw", "obywatel", "unii", "unia", "europejsk", "kodeks", "cywiln", "karn", "pracy", "ustaw", "dziennik", "monitor",
  "minist", "rad", "sejm", "senat", "prezyden", "gmin", "miast", "powiat", "wojewod", "zaklad", "ubezpiecz", "spoleczn",
  "krajow", "izb", "generaln", "inspekt", "ochron", "danych", "osobow", "biur", "komisj", "narodow", "bank", "fundusz",
  "zdrow", "sanitarn", "straz", "graniczn", "miejsk", "wojsk", "marszal", "starost", "wojt", "burmistrz", "prezes", "dyrektor",
  "kancelari", "notari", "komorni", "adwokac", "radc", "prawn", "spolk", "akcyjn", "ograniczon", "odpowiedzialn", "fundacj",
  "stowarzysz", "kas", "celn", "podatk", "skarbow", "agencj", "rzad", "premier", "parlament", "trybunal", "europ", "rodo",
  "styczn", "lut", "marc", "kwietn", "maj", "czerwc", "lip", "sierpn", "wrzesn", "pazdziernik", "listopad", "grudn",
  "poniedzial", "wtor", "srod", "czwart", "piat", "sobot", "niedziel", "internet", "google", "facebook", "allegro", "olx",
  "pan", "pani", "panstwo", "szanown", "dzien", "wesol", "bozego", "wielkanoc", "boze"
];
// A short stem takes only an ending ("Sądu", "Radzie"), so a surname that starts the same
// way ("Sadowski", "Radomski", "Pankowski") stays a candidate.
const INSTITUTION = new RegExp(
  `^(?:${INSTITUTION_STEMS.map((stem) => `${stem}\\p{L}{0,${stem.length >= 5 ? 7 : 3}}`).join("|")})$`,
  "u"
);
const ACRONYM = new Set(
  (
    "SN NSA WSA TK TSUE ETPC ETS SA SO SR ZUS KRUS KRS NIP PESEL REGON VAT PIT CIT RODO GDPR UE KC KPC KK KPK KP KPA PPSA KW KPW " +
    "KKS KKW KRO NFZ GUS KNF UOKIK UODO CBA ABW SKW SG MSWIA MF KAS CEIDG KIO PZP UZP BHP PIP OC AC IT AI NIS DORA AML ISO " +
    "SP ZOO PDF DOCX SMS MMS PIN USB WWW USA RP PL OK RPO RPD ENA NBP BIK KSEF JPK CRBR ARIMR KOWR GDOS RDOS WIOS PINB GUNB " +
    "MPZP WZ UPR UTW ROD UOKIK SANEPID PSSE GIS URPL GIF NIK IPN PKW CBOSA SAOS ELI ISAP DZU MP"
  ).split(" ")
);
const ADDRESS = /(?:^|[\s(,])(?:ul|al|pl|os)\.\s*\p{Lu}|(?:ulic|alej|osiedl|plac)\p{Ll}*\s+\p{Lu}|\b\d{2}-\d{3}\b/u;

const fold = (word: string) =>
  word.toLocaleLowerCase("pl").normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");

export function mayContainPersonalNames(text: string): boolean {
  if (ADDRESS.test(text)) return true;
  for (const sentence of text.split(/[.!?…:;]\s+|\n+/u)) {
    const words = sentence.match(/[\p{L}][\p{L}'-]*/gu) ?? [];
    for (const [index, word] of words.entries()) {
      const capitalized = /^\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?$/u.test(word);
      const allCaps = /^\p{Lu}{2,}$/u.test(word);
      if (allCaps) {
        // A known acronym (SN, NSA, ZUS) or an institution; any other may be a name in
        // capitals ("JAN NOWAK").
        if (!ACRONYM.has(fold(word).toUpperCase()) && !INSTITUTION.test(fold(word))) return true;
        continue;
      }
      if (!capitalized || index === 0) continue;
      if (!INSTITUTION.test(fold(word))) return true;
    }
  }
  return false;
}
