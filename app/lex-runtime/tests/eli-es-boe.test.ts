import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boeArticle, boeChangesAfter, boeVersionOn, parseBoeBlock } from "../src/eli/es-boe.js";

// Ley 39/2015, art. 28, read from the BOE API on 2026-11-08: the original wording and the one
// given by BOE-A-2018-16673 (in force 2018-12-07).
const xml = fs.readFileSync(path.join(import.meta.dirname, "fixtures/eli-es/BOE-A-2015-10565-a28.xml"), "utf8");

describe("Spain: consolidated article from the BOE API", () => {
  const article = parseBoeBlock(xml, "BOE-A-2015-10565", "a28");

  it("reads every version with the act that gave it and its date in force", () => {
    expect(article.title).toBe("Artículo 28");
    expect(article.versions.map((version) => [version.act, version.inForce])).toEqual([
      ["BOE-A-2015-10565", "2016-10-02"],
      ["BOE-A-2018-16673", "2018-12-07"]
    ]);
    expect(article.versions[0]!.text).toMatch(/^Artículo 28\. /u);
  });

  it("gives the wording on the date of the event and the changes after it", () => {
    expect(boeVersionOn(article, "2017-05-01")!.act).toBe("BOE-A-2015-10565");
    expect(boeVersionOn(article, "2026-11-08")!.act).toBe("BOE-A-2018-16673");
    expect(boeVersionOn(article, "2015-01-01")).toBeNull();
    expect(boeChangesAfter(article, "2017-05-01").map((version) => version.act)).toEqual(["BOE-A-2018-16673"]);
  });

  it("asks the API with Accept: application/xml and refuses a malformed identifier", async () => {
    const seen: Array<{ url: string; accept: string }> = [];
    const result = await boeArticle("BOE-A-2015-10565", "a28", async (url, init) => {
      seen.push({ url, accept: init.headers.accept! });
      return { ok: true, status: 200, text: async () => xml };
    });
    expect(seen).toEqual([{ url: "https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/BOE-A-2015-10565/texto/bloque/a28", accept: "application/xml" }]);
    expect(result.versions).toHaveLength(2);
    await expect(boeArticle("../x", "a28")).rejects.toThrow("BOE_ID_INVALID");
  });
});
