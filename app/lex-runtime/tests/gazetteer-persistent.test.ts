import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalGazetteerRecognizer } from "../src/privacy/gazetteer-ner.js";

// The gazetteer worker kept alive gives the one-shot process's answer, ~18x faster
// (benchmark 2026-10-10: 156 ms -> 9 ms per text).
const python = process.env.LEX_NER_PYTHON;
const texts = [
  "Wczoraj Anna Nowak z ul. Lipowej 3 w Krakowie zadzwoniła do Jana Kowalskiego.",
  "Pozew przeciwko Markowi Wiśniewskiemu złożyłam 3 marca.",
  "bez żadnych danych osobowych"
];

describe.skipIf(!python)("gazetteer: a worker kept alive", () => {
  const persistent = new LocalGazetteerRecognizer({ persistent: true });
  afterAll(() => persistent.close());

  it("answers as the one-shot process", async () => {
    const once = new LocalGazetteerRecognizer({ persistent: false });
    for (const text of texts) expect(await persistent.recognize(text)).toEqual(await once.recognize(text));
  });

  it("falls back to one process per text when the worker cannot start", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-gazetteer-old-"));
    const script = path.join(dir, "old.py");
    // A worker without --serve (an older payload): exits at once in serve mode.
    fs.writeFileSync(
      script,
      'import sys, json\nargs = sys.argv\nif "--serve" in args: sys.exit(2)\nopen(args[args.index("--output") + 1], "w").write("[]")\n'
    );
    const old = new LocalGazetteerRecognizer({ persistent: true, workerPath: script });
    await expect(old.recognize("Anna Nowak")).resolves.toEqual([]);
    await expect(old.recognize("Jan Kowalski")).resolves.toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe.skipIf(!python)("gazetteer: addresses", () => {
  it("a phone on the next line is not part of the street address", async () => {
    const gazetteer = new LocalGazetteerRecognizer({ persistent: false });
    const text = "43-100 Tychy, ul. Lipowa 7\nTel. 32-111 22 33; fax 32-444 55 66";
    const addresses = (await gazetteer.recognize(text)).filter((span) => span.kind === "ADDRESS").map((span) => span.value);
    expect(addresses).toContain("ul. Lipowa 7");
    expect(addresses.some((value) => /Tel|32-111/u.test(value))).toBe(false);
  });
});

describe.skipIf(!python)("gazetteer: a role word ending a sentence", () => {
  it("does not make the next sentence's first word a surname; an abbreviated title still does", async () => {
    const gazetteer = new LocalGazetteerRecognizer({ persistent: false });
    const persons = async (text: string) =>
      (await gazetteer.recognize(text)).filter((span) => span.kind === "PERSON").map((span) => span.value);
    expect(await persons("Wpłata na rachunek bankowy wierzyciela.\nBrak zapłaty w terminie spowoduje skierowanie sprawy do sądu.")).toEqual([]);
    expect(await persons("Pełnomocnik: adw. Kowalski złożył pismo.")).toContain("Kowalski");
  });
});
