import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { buildLegiIndex, legiLookup, parseLegiArticle } from "../src/eli/fr-legi.js";
import { readNationalLaw } from "../src/eli/national-law.js";

const archive = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/eli-readers/fr-legi-mini.tar.gz");
const dir = mkdtempSync(path.join(os.tmpdir(), "legi-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("France: local index of the LEGI dump", () => {
  it("streams the archive (GNU long names) into one file per code, every version kept", async () => {
    const result = await buildLegiIndex(archive, dir);
    expect(result).toEqual({ codes: 1, versions: 12 });
  });

  it("the version in force on a date, the other versions named", async () => {
    const answer = (await legiLookup({ cid: "LEGITEXT000005627819", num: "149", date: "2013-06-01" }, dir))!;
    expect(answer.code!.short).toBe("Code des marchés publics");
    expect(answer.version!.from).toBe("2012-01-01");
    expect(answer.version!.to).toBe("2014-01-01");
    expect(answer.version!.text.length).toBeGreaterThan(50);
    expect(answer.others).toHaveLength(6);
  });

  it("by article id: the code found through articles.json", async () => {
    const answer = (await legiLookup({ articleId: "LEGIARTI000024506918" }, dir))!;
    expect(answer.version!.num).toBe("35");
    expect(answer.version!.from).toBe("2011-08-27");
  });

  it("read_national_legislation on a Légifrance address uses the index, without legal force", async () => {
    process.env.LEX_LEGI_INDEX_DIR = dir;
    try {
      const answer = await readNationalLaw({ url: "https://www.legifrance.gouv.fr/codes/texte_lc/LEGITEXT000005627819", unit: "Article 35", date: "2009-01-01" });
      expect(answer.country).toBe("FR");
      expect(answer.status).toMatch(/bez mocy urzędowej/u);
      expect(answer.version).toBe("wersja MODIFIE od 2008-12-21 do 2011-08-27");
      expect(answer.articles[0]!.unit).toBe("35");
    } finally {
      delete process.env.LEX_LEGI_INDEX_DIR;
    }
  });

  it("without an index: says so instead of guessing", async () => {
    process.env.LEX_LEGI_INDEX_DIR = path.join(dir, "missing");
    try {
      const answer = await readNationalLaw({ url: "https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000024506918" });
      expect(answer.status).toBe("indeks LEGI nie jest zbudowany");
      expect(answer.articles).toEqual([]);
    } finally {
      delete process.env.LEX_LEGI_INDEX_DIR;
    }
  });

  it("amending acts written as participles (MODIFIE) are kept, citations are not", () => {
    const xml = `<ARTICLE><META><META_COMMUN><ID>LEGIARTI000032041571</ID></META_COMMUN><META_SPEC><META_ARTICLE><NUM>1240</NUM><ETAT>VIGUEUR</ETAT><DATE_DEBUT>2016-10-01</DATE_DEBUT><DATE_FIN>2999-01-01</DATE_FIN></META_ARTICLE></META_SPEC></META>
<CONTEXTE><TEXTE cid="LEGITEXT000006070721"><TITRE_TXT c_titre_court="Code civil">Code civil</TITRE_TXT></TEXTE></CONTEXTE>
<BLOC_TEXTUEL><CONTENU><p>Tout fait quelconque de l'homme…</p></CONTENU></BLOC_TEXTUEL>
<LIENS><LIEN sens="cible" typelien="CITATION">Loi du 29 juillet 1881 - art. 44 (VD)</LIEN><LIEN sens="cible" typelien="MODIFIE">Ordonnance n°2016-131 du 10 février 2016 - art. 2</LIEN></LIENS></ARTICLE>`;
    const version = parseLegiArticle(xml)!;
    expect(version.links).toEqual(["MODIFIE: Ordonnance n°2016-131 du 10 février 2016 - art. 2"]);
    expect(version.short).toBe("Code civil");
  });
});
