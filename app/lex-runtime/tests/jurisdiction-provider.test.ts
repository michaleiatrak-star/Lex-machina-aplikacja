import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeJurisdictionPack,
  configureJurisdiction,
  domainSkillPrefix,
  isDomainSkill,
  jurisdictionConnectorPackage,
  jurisdictionDegradedNotice,
  jurisdictionDomainMap,
  jurisdictionStatus,
  listJurisdictions,
  readJurisdictionProvider,
  setActiveJurisdictionPack
} from "../src/jurisdiction.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

function block(fields: Record<string, string>): string {
  return ["| Pole | Wartość |", "|---|---|", ...Object.entries(fields).map(([k, v]) => `| \`${k}\` | \`${v}\` |`), ""].join("\n");
}

describe("jurisdiction provider (DOSTAWCA JURYSDYKCJI)", () => {
  const roots: string[] = [];
  const saved = process.env.LEX_JURISDICTION_PACK;
  afterEach(() => {
    if (saved === undefined) delete process.env.LEX_JURISDICTION_PACK;
    else process.env.LEX_JURISDICTION_PACK = saved;
    configureJurisdiction(null);
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  function corpus(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-jur-prov-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "prawo-niemieckie-v1"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "prawo-niemieckie-v1", "JURYSDYKCJA.md"),
      block({
        kraj: "DE", nazwa: "Prawo niemieckie", jezyk: "de", waluta: "EUR", dziedziny: "prawo-niemieckie-v1/ROUTING-MAP.md",
        "prefiks-dziedzin": "de", konektory: "prawo-niemieckie-v1/mcp-servers", "konektory-serwery": "lex-gii, lex-juris",
        "weryfikacja-przepisow": "de-gii", orzecznictwo: "de-juris", ocr: "pl"
      })
    );
    return root;
  }

  it("Polish law is complete and the default; dr-* are its domain skills", () => {
    delete process.env.LEX_JURISDICTION_PACK;
    expect(activeJurisdictionPack()).toBe("prawo-polskie-v2");
    const pl = readJurisdictionProvider(CORPUS, "prawo-polskie-v2")!;
    expect(pl.country).toBe("PL");
    expect(pl.domainPrefix).toBe("dr");
    expect(jurisdictionStatus(pl).missing).toEqual([]);
    expect(jurisdictionDegradedNotice(jurisdictionStatus(pl))).toBeNull();
    expect(isDomainSkill("dr-02-prawo-cywilne-rodzinne-gospodarcze", CORPUS)).toBe(true);
    expect(jurisdictionConnectorPackage(CORPUS)!.replaceAll("\\", "/")).toMatch(/prawo-polskie-v2\/mcp-servers\/dist\/lex-mcp\.mjs$/u);
  });

  it("another country uses its own domain skills, connectors and map, nothing of Polish law", () => {
    const root = corpus();
    process.env.LEX_JURISDICTION_PACK = "prawo-niemieckie-v1";
    expect(domainSkillPrefix(root)).toBe("de");
    expect(isDomainSkill("de-02-zivilrecht", root)).toBe(true);
    expect(isDomainSkill("dr-02-prawo-cywilne-rodzinne-gospodarcze", root)).toBe(false);
    expect(jurisdictionDomainMap(root)).toBe("prawo-niemieckie-v1/ROUTING-MAP.md");
    expect(jurisdictionConnectorPackage(root)!.replaceAll("\\", "/")).toContain("prawo-niemieckie-v1/mcp-servers/");
    const de = readJurisdictionProvider(root, "prawo-niemieckie-v1")!;
    expect(de.connectorServers).toEqual(["lex-gii", "lex-juris"]);
  });

  it("a component without this country's provider is degraded, never served by the Polish one", () => {
    const root = corpus();
    const status = jurisdictionStatus(readJurisdictionProvider(root, "prawo-niemieckie-v1")!);
    // ocr: "pl" in a German package is the Polish provider: refused, the component is missing.
    expect(status.supported).toEqual([]);
    expect(status.missing.map((item) => item.component)).toContain("ocr");
    expect(jurisdictionDegradedNotice(status)).toMatch(/TRYB ZDEGRADOWANY/u);
  });

  it("the choice is saved in Settings, the deployment variable wins, an unknown package is refused", () => {
    const root = corpus();
    delete process.env.LEX_JURISDICTION_PACK;
    configureJurisdiction(path.join(root, "settings"));
    expect(() => setActiveJurisdictionPack(root, "prawo-nieistniejace-v1")).toThrow("JURISDICTION_UNKNOWN");
    setActiveJurisdictionPack(root, "prawo-niemieckie-v1");
    expect(activeJurisdictionPack()).toBe("prawo-niemieckie-v1");
    process.env.LEX_JURISDICTION_PACK = "prawo-polskie-v2";
    expect(activeJurisdictionPack()).toBe("prawo-polskie-v2");
    expect(listJurisdictions(root).map((item) => item.pack)).toEqual(["prawo-niemieckie-v1"]);
  });
});
