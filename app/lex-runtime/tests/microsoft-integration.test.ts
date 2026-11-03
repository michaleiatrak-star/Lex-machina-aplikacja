import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AuthenticatedContext } from "../src/auth/types.js";
import { loadMicrosoftOAuthConfig, microsoftScopes } from "../src/microsoft/config.js";
import { MicrosoftController } from "../src/microsoft/controller.js";
import { graphFiles, itemRef, listGraph } from "../src/microsoft/graph.js";
import { validateMicrosoftIdToken } from "../src/microsoft/oauth.js";

const CLIENT = "11111111-2222-3333-4444-555555555555";
const TID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-11-03T12:00:00Z");

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.sig`;
}

const goodClaims = (nonce: string) => ({
  iss: `https://login.microsoftonline.com/${TID}/v2.0`,
  aud: CLIENT,
  tid: TID,
  oid: "user-oid",
  preferred_username: "anna@kancelaria.pl",
  nonce,
  iat: NOW / 1000 - 10,
  exp: NOW / 1000 + 3600
});

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("Microsoft: konfiguracja i token tożsamości", () => {
  it("klient z env albo pliku; bez konfiguracji funkcja wyłączona; SharePoint tylko dla kont firmowych", () => {
    expect(loadMicrosoftOAuthConfig({ LEX_MICROSOFT_OAUTH_CLIENT_ID: CLIENT }, "/brak", "/brak")).toEqual({ clientId: CLIENT, tenant: "organizations" });
    expect(loadMicrosoftOAuthConfig({}, "/brak", "/brak")).toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ms-cfg-"));
    fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify({ client_id: CLIENT, tenant: "common" }));
    expect(loadMicrosoftOAuthConfig({}, path.join(dir, "c.json"), "/brak")).toEqual({ clientId: CLIENT, tenant: "common" });
    expect(() => loadMicrosoftOAuthConfig({ LEX_MICROSOFT_OAUTH_CLIENT_ID: "nie-guid" }, "/brak", "/brak")).toThrow("MICROSOFT_OAUTH_CLIENT_INVALID");
    expect(microsoftScopes("organizations")).toContain("Sites.Read.All");
    expect(microsoftScopes("consumers")).not.toContain("Sites.Read.All");
    expect(microsoftScopes("organizations")).not.toContain("Files.ReadWrite.All");
  });

  it("token tożsamości: wydawca dzierżawy, odbiorca, nonce, ważność", () => {
    expect(validateMicrosoftIdToken({ idToken: idToken(goodClaims("n1")), clientId: CLIENT, nonce: "n1", nowMs: NOW })).toEqual({
      sub: "user-oid",
      tenantId: TID,
      email: "anna@kancelaria.pl"
    });
    for (const bad of [{ nonce: "inny" }, { aud: "obcy" }, { iss: "https://evil.example/v2.0" }, { exp: NOW / 1000 - 3600 }]) {
      expect(() => validateMicrosoftIdToken({ idToken: idToken({ ...goodClaims("n1"), ...bad }), clientId: CLIENT, nonce: "n1", nowMs: NOW })).toThrow(
        "MICROSOFT_ID_TOKEN_INVALID"
      );
    }
  });
});

describe("Microsoft: połączenie konta", () => {
  it("PKCE, zapis tokenu odświeżania zaszyfrowany, rotacja tokenu przy odświeżeniu, rozłączenie", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ms-ctl-"));
    const masterKey = Buffer.alloc(32, 7);
    let refreshes = 0;
    let lastNonce = "";
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ""));
      expect(url).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/token");
      if (body.get("grant_type") === "authorization_code") {
        expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{40,}$/u);
        return json({ access_token: "at-1", refresh_token: "rt-1", id_token: idToken(goodClaims(lastNonce)), scope: "openid profile email Files.Read.All Sites.Read.All User.Read", expires_in: 3600 });
      }
      refreshes += 1;
      expect(body.get("refresh_token")).toBe(refreshes === 1 ? "rt-1" : "rt-2");
      return json({ access_token: `at-r${refreshes}`, refresh_token: `rt-${refreshes + 1}`, expires_in: 3600, scope: "Files.Read.All" });
    };
    let now = NOW;
    const controller = new MicrosoftController(
      { withSessionUserMasterKey: async (_sid, callback) => await callback(masterKey) },
      dir,
      { fetch: fetchImpl as never, now: () => now, loadConfig: () => ({ clientId: CLIENT, tenant: "organizations" }) }
    );
    const actor = { user: { userId: "user_1", displayName: "Anna" }, session: { sessionId: "s1" } } as unknown as AuthenticatedContext;
    const start = controller.startConnect(actor, "http://127.0.0.1:4000/oauth/microsoft/callback");
    const auth = new URL(start.authorizationUrl);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("scope")).toContain("offline_access");
    lastNonce = auth.searchParams.get("nonce")!;
    expect(await controller.handleCallback({ state: "obcy", code: "c" })).toBeNull();
    expect(await controller.handleCallback({ state: auth.searchParams.get("state")!, code: "c" })).toBe(true);
    expect(controller.result(start.flowId, start.flowToken)).toEqual({
      status: "DONE",
      result: { configured: true, connected: true, sharepoint: true, email: "anna@kancelaria.pl", connectedAt: new Date(NOW).toISOString() }
    });
    const stored = fs.readFileSync(path.join(dir, "microsoft", "user_1.json"), "utf8");
    expect(stored).not.toContain("rt-1");
    expect(await controller.accessToken(actor)).toBe("at-1");
    now += 2 * 3600 * 1000;
    expect(await controller.accessToken(actor)).toBe("at-r1");
    now += 2 * 3600 * 1000;
    expect(await controller.accessToken(actor)).toBe("at-r2");
    expect(await controller.disconnect(actor)).toMatchObject({ connected: false });
    await expect(controller.accessToken(actor)).rejects.toThrow("MICROSOFT_NOT_CONNECTED");
  });
});

describe("Microsoft Graph: przeglądanie i import", () => {
  const graph = "https://graph.microsoft.com/v1.0";
  it("OneDrive, udostępnione, witryny SharePoint z bibliotekami; folder pobierany rekurencyjnie", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
      if (url.startsWith(`${graph}/me/drive/root/children`)) {
        return json({
          value: [
            { id: "F1", name: "Sprawa Kowalski", folder: { childCount: 2 }, parentReference: { driveId: "D1" } },
            { id: "N1", name: "Notatnik", package: { type: "oneNote" }, parentReference: { driveId: "D1" } }
          ]
        });
      }
      if (url.startsWith(`${graph}/me/drive/sharedWithMe`)) {
        return json({ value: [{ id: "x", name: "Umowa.docx", remoteItem: { id: "R1", file: { mimeType: "application/pdf" }, size: 10, parentReference: { driveId: "D9" } } }] });
      }
      if (url.startsWith(`${graph}/sites?search=`)) return json({ value: [{ id: "contoso.sharepoint.com,abc,def", displayName: "Kancelaria" }] });
      if (url.startsWith(`${graph}/sites/`)) return json({ value: [{ id: "LIB1", name: "Dokumenty" }] });
      if (url === `${graph}/drives/D1/items/F1?$select=id,name,folder,file,size`) return json({ id: "F1", name: "Sprawa Kowalski", folder: {} });
      if (url.startsWith(`${graph}/drives/D1/items/F1/children`)) {
        return json({ value: [{ id: "P1", name: "pozew.pdf", file: { mimeType: "application/pdf" }, size: 4, parentReference: { driveId: "D1" } }] });
      }
      if (url === `${graph}/drives/D1/items/P1?$select=id,name,folder,file,size`) return json({ id: "P1", name: "pozew.pdf", file: { mimeType: "application/pdf" }, size: 4 });
      if (url === `${graph}/drives/D1/items/P1/content`) return new Response("%PDF");
      return json({}, 404);
    };
    const onedrive = await listGraph(fetchImpl as never, "tok", {});
    expect(onedrive.items).toEqual([{ id: "D1~F1", name: "Sprawa Kowalski", folder: true, kind: "folder" }]);
    expect((await listGraph(fetchImpl as never, "tok", { place: "shared" })).items[0]).toMatchObject({ id: "D9~R1", name: "Umowa.docx", kind: "file" });
    const sites = await listGraph(fetchImpl as never, "tok", { place: "sites", query: "Kancelaria" });
    expect(sites.items).toEqual([{ id: "site:contoso.sharepoint.com,abc,def", name: "Kancelaria", folder: true, kind: "site" }]);
    expect((await listGraph(fetchImpl as never, "tok", { place: sites.items[0]!.id })).items).toEqual([
      { id: "LIB1~root", name: "Dokumenty", folder: true, kind: "library" }
    ]);
    const files = await graphFiles(fetchImpl as never, "tok", "D1~F1");
    expect(files.map((file) => [file.filename, file.mediaType, Buffer.from(file.data).toString()])).toEqual([["Sprawa Kowalski - pozew.pdf", "application/pdf", "%PDF"]]);
    expect(() => itemRef("D1~../x")).toThrow("MICROSOFT_ITEM_ID_INVALID");
    await expect(listGraph(fetchImpl as never, "tok", { next: "https://evil.example/v1.0/x" })).rejects.toThrow("MICROSOFT_URL_INVALID");
  });
});
