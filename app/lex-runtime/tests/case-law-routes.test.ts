import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { AuthError, type AuthService } from "../src/auth/service.js";
import { caseLawRepository, configureCaseLawStore } from "../src/case-law-store.js";
import { CaseAccessError } from "../src/case-access.js";
import { registerMcpConnectorRoutes } from "../src/http/mcp-connector-routes.js";
import { LegalFederationToolRuntime } from "../src/legal-federation-tool-runtime.js";
import { LexMcpConnectorStore } from "../src/lex-mcp-connectors.js";

const state = fs.mkdtempSync(path.join(os.tmpdir(), "lex-case-law-routes-"));
const skillsRoot = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const authService = {
  authenticateAuthorization(header: string | undefined) {
    if (header !== "Bearer user") throw new AuthError("AUTHENTICATION_REQUIRED", 401);
    return { user: { appRole: "USER" } };
  }
} as unknown as AuthService;

const ID = "ZuUySp8Bw1HnVDW6c5lg";
const HTML = "<html><body><p>Sygn. akt II CSKP 89/26</p><p>WYROK. Sąd Najwyższy uchylił zaskarżony wyrok w sprawie sankcji kredytu darmowego.</p></body></html>";
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const calls: string[] = [];
const previewFetch = async (input: string) => {
  calls.push(input);
  if (input.includes("task=searchOrzeczenia")) {
    return json({ data: [{ data: [{ id: ID, sygnatura_sprawy: "II CSKP 89/26", data_wydania: "2026-07-08", forma_orzeczenia: "wyrok" }] }] });
  }
  if (input.includes("task=OrzeczeniePlikHtml") && input.includes(`id=${ID}`)) {
    return json({ data: [{ success: true, data: { raw: Buffer.from(HTML, "utf8").toString("base64") } }] });
  }
  return new Response("not found", { status: 404 });
};

const connectors = new LexMcpConnectorStore(skillsRoot, path.join(state, "mcp"), path.join(state, "claude.json"));
const search = new LegalFederationToolRuntime(undefined, undefined, connectors);
const app = express();
app.use(express.json());
registerMcpConnectorRoutes(app, { authService, connectors, search, previewFetch });
configureCaseLawStore(path.join(state, "case-law"));

afterAll(async () => {
  configureCaseLawStore(null);
  await search.close();
  fs.rmSync(state, { recursive: true, force: true });
});

describe("decisions the user points to", () => {
  it("a blob: link with the signature: taken from sn.pl, kept in the case under its card", async () => {
    const response = await request(app)
      .post("/api/case-law/resolve")
      .set("Authorization", "Bearer user")
      .send({ cardUrl: "blob:https://www.sn.pl/aeff2f6a-34cd-4771-8941-6b7ea9295466", signature: "II CSKP 89/26", caseId: "sprawa-1" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ court: "SN", signature: "II CSKP 89/26", cardUrl: `https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=${ID}` });
    expect(response.body.text).toContain("sankcji kredytu darmowego");
    expect(caseLawRepository()?.forCase("sprawa-1")?.get(response.body.cardUrl)?.signature).toBe("II CSKP 89/26");
    expect(caseLawRepository()?.catalog()).toEqual([]);
  });

  it("a card alone; a blob: without a signature asks for one; the library is opt-in", async () => {
    const card = await request(app)
      .post("/api/case-law/resolve")
      .set("Authorization", "Bearer user")
      .send({ cardUrl: `https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=${ID}`, caseId: "sprawa-2" });
    expect(card.status).toBe(200);
    const blob = await request(app).post("/api/case-law/resolve").set("Authorization", "Bearer user").send({ cardUrl: "blob:https://www.sn.pl/x" });
    expect(blob.body.error).toBe("CASE_LAW_BLOB_NEEDS_SIGNATURE");
    const notSn = await request(app).post("/api/case-law/resolve").set("Authorization", "Bearer user").send({ signature: "I SA/Wa 123/20" });
    expect(notSn.body.error).toBe("CASE_LAW_SIGNATURE_NOT_SN");

    expect((await request(app).get("/api/case-law/library").set("Authorization", "Bearer user")).body).toMatchObject({ enabled: false, entries: [] });
    expect((await request(app).put("/api/case-law/library").set("Authorization", "Bearer user").send({ enabled: true })).body).toEqual({ enabled: true });
    await request(app).post("/api/case-law/resolve").set("Authorization", "Bearer user").send({ signature: "II CSKP 89/26", caseId: "sprawa-3" });
    const library = await request(app).get("/api/case-law/library?q=CSKP").set("Authorization", "Bearer user");
    expect(library.body.entries).toEqual([expect.objectContaining({ court: "SN", signature: "II CSKP 89/26", date: "2026-07-08", form: "wyrok" })]);
    expect((await request(app).get("/api/case-law/library")).status).toBe(401);
  });
});

describe("case-law routes and case access", () => {
  it("does not read or write rulings in a case the user has no access to", async () => {
    const guarded = express();
    guarded.use(express.json());
    const assertAccess = (_actor: unknown, caseId: string) => {
      if (caseId !== "sprawa-wlasna") throw new CaseAccessError("CASE_ACCESS_DENIED", 403);
      return {} as never;
    };
    registerMcpConnectorRoutes(guarded, { authService, connectors, search, previewFetch, caseAccess: { assertAccess } });
    const cardUrl = `https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=${ID}`;
    for (const route of ["/api/case-law/resolve", "/api/case-law/copy", "/api/case-law/preview"]) {
      const denied = await request(guarded)
        .post(route)
        .set("Authorization", "Bearer user")
        .send({ cardUrl, sourceUrl: cardUrl, caseId: "sprawa-cudza" });
      expect(denied.status).toBe(403);
      expect(denied.body).toEqual({ error: "CASE_ACCESS_DENIED" });
    }
    expect(caseLawRepository()?.forCase("sprawa-cudza")?.get(`https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=${ID}`)).toBeNull();
    const own = await request(guarded)
      .post("/api/case-law/resolve")
      .set("Authorization", "Bearer user")
      .send({ cardUrl, caseId: "sprawa-wlasna" });
    expect(own.status).toBe(200);
  });
});
