import { randomBytes } from "node:crypto";
import express from "express";
import { snUpstream } from "../lex-mcp-connectors.js";
// Weryfikacja sn.pl w oknie przez serwer (tryb serwerowy, przeglądarka): strona sn.pl idzie przez
// serwer Lex Machina, więc sesja po przejściu ochrony (Imperva) należy do adresu serwera — tego,
// z którego konektor SN pyta potem sn.pl. Sesja z komputera użytkownika z innego adresu nie działała.
//
// Bezpieczeństwo: strona sn.pl działa pod domeną aplikacji, ale w trybie CSP `sandbox` bez
// allow-same-origin (nieprzezroczyste pochodzenie): jej skrypty nie widzą sesji, danych ani
// magazynów aplikacji. Okno otwiera jednorazowy bilet w ścieżce (15 min), nie token logowania.
// Ciasteczka trzymamy po stronie serwera; te, które skrypt wyzwania ustawia przez document.cookie
// (w piaskownicy niedostępne), przechwytuje wstrzyknięta podkładka i odsyła na serwer.
export const SN_PROXY_PREFIX = "/api/mcp-search/sn-proxy";
const TICKET_MS = 15 * 60 * 1000;
const PROBE_INTERVAL_MS = 2_500;
const MAX_TICKETS = 50;
const COOKIE_PART = /^[A-Za-z0-9_.-]{1,128}=[^;\r\n]{0,4096}$/u;
/** Set-Cookie of a response into the jar (a cookie expired in the past is removed). */
export function storeSetCookies(jar, setCookies) {
    for (const header of setCookies) {
        const first = header.split(";")[0] ?? "";
        const at = first.indexOf("=");
        if (at <= 0)
            continue;
        const name = first.slice(0, at).trim();
        const value = first.slice(at + 1).trim();
        const expires = /;\s*expires=([^;]+)/iu.exec(header)?.[1];
        const maxAge = /;\s*max-age=(-?\d+)/iu.exec(header)?.[1];
        const removed = (maxAge !== undefined && Number(maxAge) <= 0) || (expires !== undefined && Date.parse(expires) < Date.now());
        if (removed || !value)
            jar.delete(name);
        else if (COOKIE_PART.test(`${name}=${value}`))
            jar.set(name, value);
    }
}
export function cookieHeader(jar) {
    return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}
/** sn.pl links and resources pointed at the proxy of this ticket (absolute and root-relative). */
export function rewriteText(text, base, upstream) {
    // sn.pl's own links, and those of the configured address (a local imitation in tests).
    const hosts = [...new Set(["sn.pl", upstream.replace(/^https?:\/\//u, "").replace(/^www\./u, "")])];
    const absolute = new RegExp(`https?:\\/\\/(?:www\\.)?(?:${hosts.map((host) => host.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})(?![\\w.-])`, "giu");
    return text
        .replace(absolute, base)
        .replace(/((?:href|src|action|data-src)\s*=\s*["'])\/(?!\/)/giu, (_match, attribute) => `${attribute}${base}/`)
        .replace(/(url\(\s*["']?)\/(?!\/)/giu, (_match, prefix) => `${prefix}${base}/`)
        .replace(/(content=["'][^"']*?url=)\/(?!\/)/giu, (_match, prefix) => `${prefix}${base}/`)
        // A root-relative path already pointing at the proxy is not prefixed twice.
        .split(`${base}${base}`).join(base);
}
/**
 * The script opening every proxied page: root-relative fetch/XHR/resource URLs go to the proxy,
 * document.cookie (unavailable in the sandbox) is kept in memory and sent to the server at once
 * (synchronously, before the challenge reloads the page), localStorage/sessionStorage in memory.
 */
export function shimScript(base, jar) {
    const cookies = JSON.stringify(Object.fromEntries(jar));
    return `<script>(function(){
var B=${JSON.stringify(base)},J=${cookies};
function fix(u){if(typeof u!=="string")return u;if(u.indexOf("//")===0)return u;if(u.charAt(0)==="/"&&u.indexOf(B)!==0)return B+u;return u;}
try{var F=window.fetch;window.fetch=function(i,o){return F.call(this,typeof i==="string"?fix(i):i,o);};}catch(e){}
try{var O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=fix(u);return O.apply(this,arguments);};}catch(e){}
try{var S=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(/^(src|href|action)$/i.test(n))v=fix(v);return S.call(this,n,v);};}catch(e){}
["HTMLScriptElement","HTMLImageElement","HTMLIFrameElement"].forEach(function(k){try{var P=window[k].prototype,d=Object.getOwnPropertyDescriptor(P,"src");Object.defineProperty(P,"src",{get:function(){return d.get.call(this);},set:function(v){d.set.call(this,fix(v));},configurable:true});}catch(e){}});
function send(c){try{var x=new XMLHttpRequest();x.open("POST",B+"/__cookie",false);x.setRequestHeader("Content-Type","text/plain");x.send(c);}catch(e){}}
try{Object.defineProperty(document,"cookie",{configurable:true,get:function(){return Object.keys(J).map(function(k){return k+"="+J[k];}).join("; ");},set:function(v){var p=String(v).split(";")[0],i=p.indexOf("=");if(i>0){var n=p.slice(0,i).trim(),w=p.slice(i+1).trim();if(/max-age=0|expires=Thu, 01 Jan 1970/i.test(v))delete J[n];else J[n]=w;}send(String(v));}});}catch(e){}
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},setItem:function(k,v){d[k]=String(v);},removeItem:function(k){delete d[k];},clear:function(){d={};},key:function(i){return Object.keys(d)[i]||null;},get length(){return Object.keys(d).length;}};}
["localStorage","sessionStorage"].forEach(function(k){try{window[k].getItem("x");}catch(e){try{Object.defineProperty(window,k,{value:mem(),configurable:true});}catch(f){}}});
if(!window.__lexSnWatch){window.__lexSnWatch=1;setInterval(function(){try{var x=new XMLHttpRequest();x.open("GET",B+"/__status");x.onload=function(){try{if(JSON.parse(x.responseText).ready){document.title="Sesja sn.pl zapisana";window.close();}}catch(e){}};x.send();}catch(e){}},1500);}
})();</script>`;
}
/** The shim right after <head> (or at the start), the rest of the page rewritten to the proxy. */
export function proxiedHtml(html, base, upstream, jar) {
    const rewritten = rewriteText(html, base, upstream);
    const shim = shimScript(base, jar);
    return /<head[^>]*>/iu.test(rewritten) ? rewritten.replace(/<head[^>]*>/iu, (head) => `${head}${shim}`) : `${shim}${rewritten}`;
}
// Opaque origin: scripts and forms work, the application's origin (session, storage) does not.
const SANDBOX_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals";
export class SnVerificationProxy {
    connectors;
    fetchImpl;
    now;
    tickets = new Map();
    constructor(connectors, fetchImpl = fetch, now = Date.now) {
        this.connectors = connectors;
        this.fetchImpl = fetchImpl;
        this.now = now;
    }
    open(owner) {
        this.prune();
        if (this.tickets.size >= MAX_TICKETS)
            throw new Error("SN_PROXY_BUSY");
        const ticket = randomBytes(24).toString("base64url");
        this.tickets.set(ticket, { owner, createdAt: this.now(), jar: new Map(), userAgent: null, ready: false, lastProbe: 0, probing: null });
        return { ticket, url: `${SN_PROXY_PREFIX}/s/${ticket}/pl/wyszukiwarka-orzeczen` };
    }
    status(ticket, owner) {
        const entry = this.live(ticket);
        return entry && entry.owner === owner ? { ready: entry.ready } : null;
    }
    ticketReady(ticket) {
        return this.live(ticket)?.ready === true;
    }
    close(ticket, owner) {
        const entry = this.tickets.get(ticket);
        if (entry && entry.owner === owner)
            this.tickets.delete(ticket);
    }
    live(ticket) {
        const entry = this.tickets.get(ticket);
        if (!entry)
            return null;
        if (this.now() - entry.createdAt > TICKET_MS) {
            this.tickets.delete(ticket);
            return null;
        }
        return entry;
    }
    prune() {
        for (const ticket of [...this.tickets.keys()])
            this.live(ticket);
    }
    // The session passes when snproxy answers JSON from the server's address with the jar.
    probe(entry) {
        if (entry.ready || entry.probing || this.now() - entry.lastProbe < PROBE_INTERVAL_MS || !entry.jar.size)
            return entry.probing ?? Promise.resolve();
        entry.lastProbe = this.now();
        const cookie = cookieHeader(entry.jar);
        const userAgent = entry.userAgent ?? "";
        entry.probing = this.connectors
            .probeSnSession(cookie, userAgent, this.fetchImpl)
            .then(({ ready }) => {
            if (ready) {
                this.connectors.setSnSession(cookie, userAgent);
                entry.ready = true;
            }
        })
            .catch(() => undefined)
            .finally(() => {
            entry.probing = null;
        });
        return entry.probing;
    }
    /** A cookie the page's script set (document.cookie shim). */
    async acceptScriptCookie(ticket, raw) {
        const entry = this.live(ticket);
        if (!entry)
            return false;
        storeSetCookies(entry.jar, [raw.slice(0, 4_200)]);
        entry.lastProbe = 0;
        await this.probe(entry);
        return true;
    }
    async forward(ticket, req, res, rest) {
        const entry = this.live(ticket);
        res.removeHeader("Cross-Origin-Opener-Policy");
        res.removeHeader("Cross-Origin-Embedder-Policy");
        res.removeHeader("Cross-Origin-Resource-Policy");
        res.removeHeader("X-Frame-Options");
        res.setHeader("Content-Security-Policy", SANDBOX_CSP);
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Cache-Control", "no-store");
        if (!entry) {
            res.status(410).type("text/html").send("<p>Okno weryfikacji sn.pl wygasło. Zamknij je i otwórz ponownie w aplikacji.</p>");
            return;
        }
        const browserAgent = req.get("user-agent") ?? "";
        if (/^Mozilla\/5\.0 [\x20-\x7e]{10,400}$/u.test(browserAgent))
            entry.userAgent = browserAgent;
        const upstream = snUpstream();
        const base = `${SN_PROXY_PREFIX}/s/${ticket}`;
        const query = new URLSearchParams(req.query).toString();
        const target = `${upstream}${rest.startsWith("/") ? rest : `/${rest}`}${query ? `?${query}` : ""}`;
        // The application's JSON parser may have read the body first: sent on as JSON again.
        const body = req.method === "GET" || req.method === "HEAD"
            ? undefined
            : Buffer.isBuffer(req.body)
                ? new Uint8Array(req.body)
                : typeof req.body === "string"
                    ? req.body
                    : req.body && typeof req.body === "object" && Object.keys(req.body).length
                        ? JSON.stringify(req.body)
                        : undefined;
        let response;
        try {
            response = await this.fetchImpl(target, {
                method: req.method,
                redirect: "manual",
                headers: {
                    "user-agent": entry.userAgent ?? browserAgent,
                    accept: req.get("accept") ?? "*/*",
                    "accept-language": req.get("accept-language") ?? "pl-PL,pl;q=0.9",
                    ...(req.get("content-type") ? { "content-type": req.get("content-type") } : {}),
                    ...(req.get("x-requested-with") ? { "x-requested-with": req.get("x-requested-with") } : {}),
                    ...(entry.jar.size ? { cookie: cookieHeader(entry.jar) } : {})
                },
                ...(body ? { body } : {}),
                signal: AbortSignal.timeout(30_000)
            });
        }
        catch {
            res.status(502).type("text/html").send("<p>sn.pl nie odpowiada z serwera Lex Machina.</p>");
            return;
        }
        storeSetCookies(entry.jar, response.headers.getSetCookie?.() ?? []);
        void this.probe(entry);
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            if (location) {
                const next = new URL(location, target);
                if (next.origin !== new URL(upstream).origin && next.hostname.replace(/^www\./u, "") !== new URL(upstream).hostname.replace(/^www\./u, "")) {
                    res.status(502).type("text/html").send("<p>sn.pl przekierował poza sn.pl — przerwano.</p>");
                    return;
                }
                res.redirect(response.status, `${base}${next.pathname}${next.search}`);
                return;
            }
        }
        const type = response.headers.get("content-type") ?? "application/octet-stream";
        res.status(response.status);
        res.setHeader("Content-Type", type);
        if (/text\/html/iu.test(type)) {
            res.send(proxiedHtml(await response.text(), base, upstream, entry.jar));
        }
        else if (/(?:javascript|text\/css|json)/iu.test(type)) {
            res.send(rewriteText(await response.text(), base, upstream));
        }
        else {
            res.send(Buffer.from(await response.arrayBuffer()));
        }
    }
}
/**
 * The proxy's routes; the window's own requests carry only the ticket, the others the login.
 * Plain string paths: the desktop route allowlist check reads them (blocked there on purpose,
 * the desktop has its own sn.pl window).
 */
export function registerSnProxyRoutes(app, dependencies) {
    const { authService, proxy } = dependencies;
    const owner = (req, res) => {
        try {
            return authService.authenticateAuthorization(req.get("authorization")).user.userId;
        }
        catch {
            res.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
            return null;
        }
    };
    app.post("/api/mcp-search/sn-proxy/ticket", (req, res) => {
        const user = owner(req, res);
        if (!user)
            return;
        try {
            res.json(proxy.open(user));
        }
        catch {
            res.status(429).json({ error: "SN_PROXY_BUSY" });
        }
    });
    app.get("/api/mcp-search/sn-proxy/ticket/:ticket", (req, res) => {
        const user = owner(req, res);
        if (!user)
            return;
        const status = proxy.status(String(req.params.ticket), user);
        if (!status)
            res.status(404).json({ error: "SN_PROXY_TICKET_UNKNOWN" });
        else
            res.json(status);
    });
    app.delete("/api/mcp-search/sn-proxy/ticket/:ticket", (req, res) => {
        const user = owner(req, res);
        if (!user)
            return;
        proxy.close(String(req.params.ticket), user);
        res.json({ closed: true });
    });
    // The window closes itself once the session works (the application's handle may be cut off
    // by Cross-Origin-Opener-Policy): the ticket's state, nothing else.
    app.get("/api/mcp-search/sn-proxy/s/:ticket/__status", (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "no-store");
        res.json({ ready: proxy.ticketReady(String(req.params.ticket)) });
    });
    app.post("/api/mcp-search/sn-proxy/s/:ticket/__cookie", express.text({ type: "*/*", limit: "8kb" }), async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        const accepted = await proxy.acceptScriptCookie(String(req.params.ticket), typeof req.body === "string" ? req.body : "");
        res.status(accepted ? 204 : 410).end();
    });
    app.all(`${SN_PROXY_PREFIX}/s/:ticket{/*rest}`, express.raw({ type: "*/*", limit: "1mb" }), async (req, res) => {
        const rest = req.path.slice(`${SN_PROXY_PREFIX}/s/${String(req.params.ticket)}`.length) || "/";
        // Requests of the sandboxed page come from an opaque origin ("null"): no credentials, ticket only.
        res.setHeader("Access-Control-Allow-Origin", "*");
        await proxy.forward(String(req.params.ticket), req, res, rest);
    });
}
