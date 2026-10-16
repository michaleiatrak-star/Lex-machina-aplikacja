import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Windows checkout (core.autocrlf) gave the TERYT and PESEL bases CRLF line ends: the "\r" in
// the last field of a row stopped the gazetteer (ValueError in address_base.py), the app showed
// "Morfeusz: błąd uruchomienia". The bases are read the same with either line end.
const PRIVACY = path.resolve(__dirname, "../../privacy");
const python = process.env.LEX_NER_PYTHON;
const morfeusz = python ? spawnSync(python, ["-c", "import morfeusz2"]).status === 0 : false;

describe.skipIf(!morfeusz)("gazetteer na bazach z końcami linii CRLF (Windows)", () => {
  it("rozpoznaje osobę i adres jak przy LF", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-crlf-"));
    try {
      for (const name of ["localities_teryt", "streets_teryt", "surnames_pesel"]) {
        const text = fs.readFileSync(path.join(PRIVACY, `${name}.tsv`), "utf8");
        fs.writeFileSync(path.join(root, `${name}.tsv`), text.replace(/\n/gu, "\r\n"));
      }
      const input = path.join(root, "in.txt");
      const output = path.join(root, "out.json");
      fs.writeFileSync(input, "Pozwany Jan Kowalski, zamieszkały przy ul. Długiej 5 w Krakowie, nie stawił się.");
      const run = spawnSync(python!, ["-X", "utf8", path.join(PRIVACY, "polish_pii_gazetteer.py"), "--input", input, "--output", output], {
        env: { ...process.env, LEX_ADDRESS_BASE_DIR: root, LEX_SURNAME_BASE: path.join(root, "surnames_pesel.tsv") },
        encoding: "utf8"
      });
      expect(run.stderr).not.toContain("Traceback");
      expect(run.status).toBe(0);
      const spans = JSON.parse(fs.readFileSync(output, "utf8")) as Array<{ kind: string; value: string }>;
      expect(spans.map((span) => `${span.kind}:${span.value}`)).toEqual(expect.arrayContaining(["PERSON:Jan Kowalski", "ADDRESS:ul. Długiej 5"]));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});

// The online installer's embedded Python (python._pth) does not put the script's folder on
// sys.path, like -I here: the workers failed on their sibling modules (address_base).
describe.skipIf(!morfeusz)("workery bez katalogu skryptu w sys.path (Python embeddable)", () => {
  it.each(["polish_pii_gazetteer.py", "polish_person_morphology.py"])("%s startuje z -I", (worker) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-isolated-"));
    try {
      const input = path.join(root, "in");
      const output = path.join(root, "out.json");
      fs.writeFileSync(input, worker.includes("gazetteer") ? "Jan Kowalski mieszka przy ul. Długiej 5." : JSON.stringify({ persons: [{ surface: "Jana Kowalskiego" }], addresses: [], words: [] }));
      const run = spawnSync(python!, ["-I", "-X", "utf8", path.join(PRIVACY, worker), "--input", input, "--output", output], { cwd: os.tmpdir(), encoding: "utf8" });
      expect(run.stderr).not.toContain("ModuleNotFoundError");
      expect(run.status).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
