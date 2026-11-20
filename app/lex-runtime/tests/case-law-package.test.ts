import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { AuthError, type AuthService } from "../src/auth/service.js";
import { CaseLawDatabase, setSharedCaseLawDatabase, type CaseLawImportResult } from "../src/case-law-db.js";
import { caseLawRepository, configureCaseLawStore } from "../src/case-law-store.js";
import { registerMcpConnectorRoutes } from "../src/http/mcp-connector-routes.js";
import { LegalFederationToolRuntime } from "../src/legal-federation-tool-runtime.js";
import { LexMcpConnectorStore } from "../src/lex-mcp-connectors.js";

// Fabricated rulings: the package format, not real case law.
const card = (source: "SN" | "SP", sourceId: string, signature: string, date: string) => ({
  source,
  sourceId,
  court: source === "SN" ? "Sąd Najwyższy" : "Sąd Okręgowy w Testowie",
  courtType: source === "SN" ? "SUPREME" : "COMMON",
  division: null,
  signatures: [signature],
  date,
  kind: "wyrok",
  judges: [],
  keywords: [],
  legalBases: [],
  summary: null,
  url: `https://example.test/${sourceId}`,
  modified: null
});
const empty = (): CaseLawImportResult => ({ format: null, imported: 0, skipped: 0, invalid: 0, sources: {} });
const temp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe("package of the local database of rulings", () => {
  it("round trip: every ruling keeps its source, text and the sync state; a second load adds nothing", () => {
    const built = new CaseLawDatabase(temp("lex-pkg-a-"));
    built.upsert(card("SN", "sn-1", "I XYZ 1/26", "2026-01-10") as never, "treść pierwszego orzeczenia testowego ".repeat(4), [{ kind: "przepis", target: "art. 1 KC", label: null } as never]);
    built.upsert(card("SP", "sp-1", "II ABC 2/26", "2026-02-11") as never, "treść drugiego orzeczenia testowego ".repeat(4), []);
    built.saveState("SN:izba", { page: 7 });
    const lines = [...built.exportLines(["SN"])];
    expect(JSON.parse(lines[0]!)).toMatchObject({ format: "lex-case-law/1", documents: { SN: 1 } });
    expect(lines).toHaveLength(3);

    const loaded = new CaseLawDatabase(temp("lex-pkg-b-"));
    const result = empty();
    for (const line of lines) loaded.importLine(line, result);
    expect(result).toMatchObject({ format: "lex-case-law/1", imported: 1, skipped: 0, invalid: 0, sources: { SN: 1 } });
    expect(loaded.count("SN")).toBe(1);
    expect(loaded.count("SP")).toBe(0);
    expect(loaded.state("SN:izba")).toEqual({ page: 7 });

    const again = empty();
    for (const line of lines) loaded.importLine(line, again);
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
  });

  it("an unknown format is refused; a broken line is counted, not stored", () => {
    const db = new CaseLawDatabase(temp("lex-pkg-c-"));
    expect(() => db.importLine(JSON.stringify({ format: "inny/9" }), empty())).toThrow("CASE_LAW_PACKAGE_FORMAT_UNKNOWN");
    const result = empty();
    db.importLine("{nie json", result);
    db.importLine(JSON.stringify({ card: { ...card("SN", "x", "I X 1/26", "2026-01-01"), source: "OBCE" } }), result);
    expect(result.invalid).toBe(2);
  });
});

describe("package routes", () => {
  const state = temp("lex-pkg-routes-");
  const previous = process.env.LEX_CASE_LAW_DB_DIR;
  process.env.LEX_CASE_LAW_DB_DIR = path.join(state, "db");
  const authService = {
    authenticateAuthorization(header: string | undefined) {
      if (header === "Bearer admin") return { user: { appRole: "ADMIN" } };
      if (header === "Bearer user") return { user: { appRole: "USER" } };
      throw new AuthError("AUTHENTICATION_REQUIRED", 401);
    }
  } as unknown as AuthService;
  const connectors = new LexMcpConnectorStore(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"), path.join(state, "mcp"), path.join(state, "claude.json"));
  const search = new LegalFederationToolRuntime(undefined, undefined, connectors);
  const app = express();
  app.use(express.json());
  registerMcpConnectorRoutes(app, { authService, connectors, search });
  setSharedCaseLawDatabase(null);

  afterAll(async () => {
    setSharedCaseLawDatabase(null);
    if (previous === undefined) delete process.env.LEX_CASE_LAW_DB_DIR;
    else process.env.LEX_CASE_LAW_DB_DIR = previous;
    await search.close();
    fs.rmSync(state, { recursive: true, force: true });
  });

  const source = new CaseLawDatabase(temp("lex-pkg-src-"));
  source.upsert(card("SN", "sn-9", "III QWE 9/26", "2026-03-03") as never, "treść orzeczenia do paczki ".repeat(4), []);
  const pkg = gzipSync([...source.exportLines()].join("\n") + "\n");

  it("only an administrator loads a package; it creates the database and exports it back", async () => {
    const denied = await request(app).post("/api/case-law/import").set("Authorization", "Bearer user").set("Content-Type", "application/gzip").send(pkg);
    expect(denied.status).toBe(403);

    const loaded = await request(app).post("/api/case-law/import").set("Authorization", "Bearer admin").set("Content-Type", "application/gzip").send(pkg);
    expect(loaded.status).toBe(200);
    expect(loaded.body).toMatchObject({ imported: 1, sources: { SN: 1 } });

    const exported = await request(app)
      .get("/api/case-law/export?sources=SN")
      .set("Authorization", "Bearer user")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    const lines = gunzipSync(exported.body as Buffer).toString("utf8").trim().split("\n");
    expect(JSON.parse(lines[1]!).card).toMatchObject({ source: "SN", signatures: ["III QWE 9/26"] });
  });

  it("the library's copies (rulings read in the user's work, e.g. sn.pl through its window) travel too", async () => {
    const cardUrl = "https://www.sn.pl/wyszukiwanie/SitePages/orzeczenia.aspx?orzeczenie=TEST-1";
    configureCaseLawStore(temp("lex-pkg-lib-a-"));
    caseLawRepository()!.setLibraryEnabled(true);
    caseLawRepository()!.put({ cardUrl, signature: "IV TST 4/26", date: "2026-04-04", form: "postanowienie", text: "uzasadnienie postanowienia testowego ".repeat(4) });
    const exported = await request(app)
      .get("/api/case-law/export?sources=SN")
      .set("Authorization", "Bearer user")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(JSON.parse(gunzipSync(exported.body as Buffer).toString("utf8").split("\n")[0]!)).toMatchObject({ library: 1 });

    configureCaseLawStore(temp("lex-pkg-lib-b-"));
    expect(caseLawRepository()!.libraryEnabled()).toBe(false);
    const loaded = await request(app).post("/api/case-law/import").set("Authorization", "Bearer admin").set("Content-Type", "application/gzip").send(exported.body as Buffer);
    expect(loaded.status).toBe(200);
    expect(loaded.body.sources).toMatchObject({ SN: 1 });
    expect(caseLawRepository()!.libraryEnabled()).toBe(true);
    expect(caseLawRepository()!.get(cardUrl)).toMatchObject({ court: "SN", signature: "IV TST 4/26", form: "postanowienie" });
    configureCaseLawStore(null);
  });

  it("a file that is not a package is refused", async () => {
    const response = await request(app).post("/api/case-law/import").set("Authorization", "Bearer admin").set("Content-Type", "application/x-ndjson").send('{"a":1}\n');
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("CASE_LAW_PACKAGE_FORMAT_UNKNOWN");
  });
});
