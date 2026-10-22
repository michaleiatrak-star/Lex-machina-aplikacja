import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieHeader, proxiedHtml, registerSnProxyRoutes, SnVerificationProxy, storeSetCookies } from "../src/http/sn-proxy.js";

// An imitation of sn.pl behind Imperva: a challenge page whose script loads a resource (cookie in
// Set-Cookie) and sets another with document.cookie; snproxy answers JSON only with both.
let upstream: http.Server;
let base = "";
const saved: Array<{ cookie: string; userAgent: string }> = [];
beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    const cookie = req.headers.cookie ?? "";
    const ok = /reese84=/.test(cookie) && /visid_incap_1=/.test(cookie);
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/_Incapsula_Resource") {
      res.writeHead(200, { "content-type": "application/javascript", "set-cookie": "visid_incap_1=v1; path=/; HttpOnly" });
      res.end("/* */");
    } else if (url.pathname === "/pl/index.php") {
      res.writeHead(ok ? 200 : 403, { "content-type": ok ? "application/json" : "text/html" });
      res.end(ok ? "[{\"data\":[]}]" : "<html>Incapsula</html>");
    } else if (url.pathname === "/old") {
      res.writeHead(302, { location: "https://login.example.com/x" });
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(ok ? "<html><head></head><body>Wyszukiwarka</body></html>" : "<html><head><script src=\"/_Incapsula_Resource?a=1\"></script></head><body><a href=\"https://www.sn.pl/pl/x\">x</a></body></html>");
    }
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  process.env.LEX_SN_UPSTREAM = base;
});
afterAll(() => {
  delete process.env.LEX_SN_UPSTREAM;
  upstream.close();
});

function app() {
  const proxy = new SnVerificationProxy({
    async probeSnSession(cookie: string) {
      const r = await fetch(`${base}/pl/index.php?option=com_ajax`, { headers: { cookie } });
      return { ready: r.status === 200, status: r.status };
    },
    setSnSession(cookie: string, userAgent: string) {
      saved.push({ cookie, userAgent });
      return { savedAt: "now", cookies: cookie.split(";").length };
    }
  } as never);
  const server = express();
  server.use(express.json());
  registerSnProxyRoutes(server, {
    authService: {
      authenticateAuthorization(header?: string) {
        if (header !== "Bearer u1" && header !== "Bearer u2") throw new Error("AUTH");
        return { user: { userId: header.slice(7) } } as never;
      }
    },
    proxy
  });
  return server;
}

describe("okno weryfikacji sn.pl przez serwer (tryb serwerowy)", () => {
  it("bilet tylko dla zalogowanego; strona sn.pl w piaskownicy, linki na proxy; sesja z obu ciasteczek zapisana", async () => {
    const server = app();
    await request(server).post("/api/mcp-search/sn-proxy/ticket").expect(401);
    const opened = await request(server).post("/api/mcp-search/sn-proxy/ticket").set("authorization", "Bearer u1").expect(200);
    const { ticket, url } = opened.body as { ticket: string; url: string };
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/u);
    const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    const page = await request(server).get(url).set("user-agent", ua).expect(200);
    expect(page.headers["content-security-policy"]).toMatch(/^sandbox allow-scripts/u);
    expect(page.headers["cross-origin-opener-policy"]).toBeUndefined();
    expect(page.text).toContain(`src="/api/mcp-search/sn-proxy/s/${ticket}/_Incapsula_Resource?a=1"`);
    expect(page.text).toContain(`href="/api/mcp-search/sn-proxy/s/${ticket}/pl/x"`);
    expect(page.text).toContain('Object.defineProperty(document,"cookie"');
    // The browser loads the resource (Set-Cookie to the server's jar) and the script sets a cookie.
    await request(server).get(`/api/mcp-search/sn-proxy/s/${ticket}/_Incapsula_Resource?a=1`).set("user-agent", ua).expect(200);
    expect((await request(server).get(`/api/mcp-search/sn-proxy/ticket/${ticket}`).set("authorization", "Bearer u1")).body.ready).toBe(false);
    await request(server).post(`/api/mcp-search/sn-proxy/s/${ticket}/__cookie`).set("content-type", "text/plain").send("reese84=tok; path=/; max-age=3600").expect(204);
    expect((await request(server).get(`/api/mcp-search/sn-proxy/ticket/${ticket}`).set("authorization", "Bearer u1")).body.ready).toBe(true);
    expect((await request(server).get(`/api/mcp-search/sn-proxy/s/${ticket}/__status`)).body.ready).toBe(true);
    expect(saved.at(-1)).toEqual({ cookie: "visid_incap_1=v1; reese84=tok", userAgent: ua });
    // Another user cannot read the ticket; a redirect off sn.pl is cut; an unknown ticket expires.
    await request(server).get(`/api/mcp-search/sn-proxy/ticket/${ticket}`).set("authorization", "Bearer u2").expect(404);
    await request(server).get(`/api/mcp-search/sn-proxy/s/${ticket}/old`).expect(502);
    await request(server).get("/api/mcp-search/sn-proxy/s/nieznany/pl").expect(410);
  });

  it("słoik ciasteczek: usunięcie po wygaśnięciu, nagłówek Cookie; podkładka na początku <head>", () => {
    const jar = new Map<string, string>();
    storeSetCookies(jar, ["a=1; path=/", "b=2; HttpOnly", "a=; expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
    expect(cookieHeader(jar)).toBe("b=2");
    const html = proxiedHtml("<html><head><title>t</title></head><body><img src=\"/i.png\"></body></html>", "/p/s/T", "https://www.sn.pl", jar);
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<title>"));
    expect(html).toContain('src="/p/s/T/i.png"');
  });
});
