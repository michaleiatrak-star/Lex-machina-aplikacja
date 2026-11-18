import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDocument } from "../src/document-kind.js";
import { decideTask, parseActivationMatrix, parseRedactionTest, parseRoutingTable } from "../src/task-routing.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const routes = parseRoutingTable(fs.readFileSync(path.join(CORPUS, "prawny-router-v3/SKILL.md"), "utf8"));
const matrix = parseActivationMatrix(fs.readFileSync(path.join(CORPUS, "shared/ACTIVATION-MATRIX.md"), "utf8"));
const redaction = parseRedactionTest(fs.readFileSync(path.join(CORPUS, "pisma-procesowe-v3/SKILL.md"), "utf8"));
const kind = (text: string) => classifyDocument({ text });

// a live case: a refusal to open disciplinary proceedings, the hearing protocol, the party's earlier complaint.
const refusal = kind(
  "Rzecznik Dyscyplinarny Okręgowej Rady Adwokackiej\nSygn. a live case\nPOSTANOWIENIE\no odmowie wszczęcia postępowania dyscyplinarnego\nUZASADNIENIE"
);
const protocol = kind("PROTOKÓŁ\nz dnia 16 października 2025 r.\nObecni: ...\nPełnomocnik oświadczył, że każda taka sytuacja będzie traktowana jako nękanie.");
const complaint = kind(
  "ZAWIADOMIENIE O PODEJRZENIU POPEŁNIENIA PRZEWINIENIA DYSCYPLINARNEGO\nDo Rzecznika Dyscyplinarnego ORA\nZawiadamiam o przewinieniu adwokata i wnoszę o wszczęcie postępowania."
);
// V P 3/26: a labour case with the hearing protocol and witnesses.
const hearing = kind("Sygn. akt V P 3/26\nPROTOKÓŁ ROZPRAWY\nŚwiadek [PII:PERSON:0001] zeznaje: ...");
const judgment = kind("Sygn. akt I C 1/24\nWYROK\nW IMIENIU RZECZYPOSPOLITEJ POLSKIEJ");

describe("a pleading to a court or an authority is led by pisma-procesowe-v3", () => {
  it("a live case: challenging the refusal, the court analysis only serves the pleading", () => {
    const decision = decideTask(routes, matrix, "Przygotuj podważenie postanowienia o odmowie wszczęcia postępowania dyscyplinarnego.", [refusal, protocol, complaint], redaction);
    expect(decision?.primary).toBe("pisma-procesowe-v3");
    expect(decision?.then).toBeNull();
    expect(decision?.reason).toMatch(/pismo do sądu lub organu/u);
  });

  it("V P 3/26: a pleading with evidence motions, the witness skill does not lead", () => {
    const decision = decideTask(routes, matrix, "Przygotuj pismo procesowe z wnioskami dowodowymi o przesłuchanie świadków.", [hearing], redaction);
    expect(decision?.primary).toBe("pisma-procesowe-v3");
  });

  it("an appeal from a delivered judgment: the analysis is auxiliary", () => {
    const decision = decideTask(routes, matrix, "Napisz apelację od tego wyroku.", [judgment], redaction);
    expect(decision).toMatchObject({ primary: "pisma-procesowe-v3", then: null, auxiliary: ["analiza-sadowa-v6"] });
  });

  it("termin apelacji: a question about a deadline is not a pleading", () => {
    expect(decideTask(routes, matrix, "Jaki jest termin na wniesienie apelacji od tego wyroku?", [judgment], redaction)?.primary).not.toBe("pisma-procesowe-v3");
    expect(decideTask(routes, matrix, "Do kiedy mogę złożyć apelację?", [], redaction)?.primary ?? null).not.toBe("pisma-procesowe-v3");
  });

  it("questions for a witness and a simple letter keep their skills", () => {
    expect(decideTask(routes, matrix, "Przygotuj pytania do świadka na rozprawę apelacyjną.", [hearing], redaction)?.primary).toBe("przesluchanie-swiadkow-v2-min90");
    expect(decideTask(routes, matrix, "Przygotuj ocenę szans apelacji, czy warto?", [judgment], redaction)?.primary).not.toBe("pisma-procesowe-v3");
  });
});
