import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Socket } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { NetworkAccess } from "../server-mode/service.js";
import type { TlsMaterial } from "./tls-certificate.js";

/**
 * Aplikacja w przeglądarce: serwer podaje stronę (lex-web) i API pod jednym adresem.
 * Domyślnie tylko z tego komputera (127.0.0.1); dostęp z sieci włącza administrator w trybie
 * serwerowym i tylko z tego komputera. Okno aplikacji desktop łączy się osobnym kanałem z tokenem.
 */
export const DEFAULT_BROWSER_PORT = 4317;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const BROWSER_SAME_ORIGIN = Symbol.for("lex.browserSameOrigin");

// Funkcje okna aplikacji desktop (jego token, tożsamość wsparcia) nie są dostępne ze strony.
const DESKTOP_WINDOW_ONLY = [/^\/api\/auth\/bootstrap-managed$/, /^\/api\/admin\/support(?:\/|$)/];

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const plain = address.startsWith("::ffff:") ? address.slice(7) : address;
  return plain === "::1" || /^127\./.test(plain);
}

function hostName(hostHeader: string | undefined): string {
  if (!hostHeader) return "";
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || (hostname.startsWith("[") && hostname.endsWith("]"));
}

/** Nazwy hostów dopuszczone w dostępie z sieci poza adresami IP (np. nazwa serwera kancelarii). */
function allowedHostNames(publicBaseUrl: () => string): Set<string> {
  const names = new Set<string>();
  for (const item of (process.env.LEX_ALLOWED_HOSTS ?? "").split(",")) {
    const name = item.trim().toLowerCase();
    if (name) names.add(name);
  }
  const base = publicBaseUrl().trim();
  if (base) {
    try {
      names.add(new URL(base).hostname.toLowerCase());
    } catch {
      // Niepoprawny adres w ustawieniach nie poszerza listy.
    }
  }
  names.add(os.hostname().toLowerCase());
  return names;
}

export function resolveWebRoot(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.LEX_WEB_ROOT?.trim(),
    // Instalacja: app/dist/http -> app/web.
    path.resolve(here, "../../web"),
    // Repozytorium: app/lex-runtime/dist/http -> app/lex-web/dist.
    path.resolve(here, "../../../lex-web/dist")
  ].filter((item): item is string => Boolean(item));
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html")));
}

// Bez upgrade-insecure-requests: w sieci lokalnej strona działa także po HTTP.
const WEB_CSP =
  "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; frame-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; " +
  "base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

/** Strona aplikacji (pliki z lex-web/dist) i powrót do index.html dla ścieżek aplikacji. */
export function registerWebApp(app: Express, webRoot: string | undefined): void {
  if (!webRoot) return;
  // Czytany przy każdym żądaniu: po aktualizacji strona wskazuje nowe pliki.
  const index = () =>
    fs.readFileSync(path.join(webRoot, "index.html"), "utf8").replace("<head>", '<head>\n    <meta name="lex-api-base" content="same-origin" />');
  app.use(express.static(webRoot, { index: false, fallthrough: true, maxAge: "1h" }));
  app.get(/^\/(?!api(?:\/|$)|health$|oauth\/).*/, (req, res, next) => {
    if (path.extname(req.path)) {
      next();
      return;
    }
    res.set("Content-Security-Policy", WEB_CSP);
    res.set("Cache-Control", "no-store");
    res.type("html").send(index());
  });
}

export class BrowserAccess {
  private server: net.Server | undefined;
  private readonly open = new Set<Socket>();
  private readonly sockets = new WeakSet<Socket>();
  private mode: NetworkAccess = "LOCAL";
  private port: number;
  private tls: TlsMaterial | undefined;
  state: "OFF" | "LISTENING" | "UNAVAILABLE" = "OFF";
  error: string | undefined;

  constructor(
    private readonly handler: http.RequestListener,
    port: number,
    private readonly publicBaseUrl: () => string = () => "",
    private readonly localHost = "127.0.0.1",
    // HTTPS (domyślnie w serwerze): certyfikat przy każdym uruchomieniu nasłuchu; brak: HTTP.
    private readonly tlsProvider?: () => TlsMaterial | undefined
  ) {
    this.port = port;
  }

  get networkAccess(): NetworkAccess {
    return this.mode;
  }

  get listeningPort(): number {
    return this.port;
  }

  get protocol(): "https" | "http" {
    return this.tls ? "https" : "http";
  }

  certificate(): Omit<TlsMaterial, "key"> | undefined {
    if (!this.tls) return undefined;
    const { key: _key, ...publicPart } = this.tls;
    return publicPart;
  }

  isBrowserSocket(socket: Socket): boolean {
    return this.sockets.has(socket);
  }

  /**
   * HTTP na porcie z HTTPS: strona przechodzi na https:// (ten sam adres i port); z tego komputera
   * API i /health odpowiadają też po HTTP (narzędzia lokalne), z sieci tylko HTTPS.
   */
  private plainOverTls(serve: http.RequestListener): http.RequestListener {
    return (req, res) => {
      const pathname = (req.url ?? "/").split("?")[0] ?? "/";
      const local = isLoopbackAddress(req.socket.remoteAddress);
      if (local && (pathname === "/health" || pathname.startsWith("/api/") || pathname.startsWith("/oauth/"))) {
        serve(req, res);
        return;
      }
      const host = req.headers.host ?? "";
      if ((req.method === "GET" || req.method === "HEAD") && /^[A-Za-z0-9.\-:[\]]+$/.test(host)) {
        res.writeHead(308, { Location: `https://${host}${req.url ?? "/"}`, "Cache-Control": "no-store" });
        res.end();
        return;
      }
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "HTTPS_REQUIRED" }));
    };
  }

  private listen(host: string): Promise<net.Server> {
    const material = this.tlsProvider?.();
    this.tls = material;
    const serve: http.RequestListener = (req, res) => {
      this.sockets.add(req.socket);
      this.handler(req, res);
    };
    const plain = http.createServer(material ? this.plainOverTls(serve) : serve);
    const secure = material ? https.createServer({ key: material.key, cert: material.cert }, serve) : undefined;
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.open.add(socket);
        socket.once("close", () => this.open.delete(socket));
        if (!secure) {
          plain.emit("connection", socket);
          return;
        }
        // Pierwszy bajt 0x16 to początek uzgadniania TLS; inaczej zwykłe HTTP.
        socket.once("data", (chunk: Buffer) => {
          socket.pause();
          socket.unshift(chunk);
          (chunk[0] === 0x16 ? secure : plain).emit("connection", socket);
          process.nextTick(() => socket.resume());
        });
      });
      server.once("error", reject);
      server.listen(this.port, host, () => {
        server.off("error", reject);
        const address = server.address();
        if (typeof address === "object" && address) this.port = address.port;
        resolve(server);
      });
    });
  }

  private async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      for (const socket of this.open) socket.destroy();
      this.open.clear();
    });
  }

  async start(mode: NetworkAccess = "LOCAL"): Promise<void> {
    try {
      this.server = await this.listen(mode === "NETWORK" ? "0.0.0.0" : this.localHost);
      this.mode = mode;
      this.state = "LISTENING";
      this.error = undefined;
    } catch (error) {
      if (mode === "NETWORK") {
        await this.start("LOCAL");
        return;
      }
      this.state = "UNAVAILABLE";
      this.error = error instanceof Error ? (error as NodeJS.ErrnoException).code ?? error.message : String(error);
    }
  }

  /** Zmiana dostępu: nasłuch od nowa na tym samym porcie (połączenia z sieci są zamykane). */
  async setMode(mode: NetworkAccess): Promise<void> {
    if (mode === this.mode && this.state === "LISTENING") return;
    await this.restart(mode);
  }

  /** Nowy nasłuch (np. po zmianie HTTPS/HTTP albo certyfikatu). */
  async restart(mode: NetworkAccess = this.mode): Promise<void> {
    await this.close();
    await this.start(mode);
  }

  async stop(): Promise<void> {
    await this.close();
    this.state = "OFF";
  }

  addresses(): string[] {
    if (this.state !== "LISTENING") return [];
    const loopback = this.localHost.includes(":") ? `[${this.localHost}]` : this.localHost;
    const list = [`${this.protocol}://${loopback}:${this.port}`];
    if (this.mode === "NETWORK") {
      for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries ?? []) {
          if (entry.family === "IPv4" && !entry.internal) list.push(`${this.protocol}://${entry.address}:${this.port}`);
        }
      }
    }
    return list;
  }

  /**
   * Zabezpieczenia kanału strony: w trybie lokalnym tylko adresy 127.0.0.1 i nazwy hostów
   * pętli zwrotnej (ochrona przed DNS rebinding); w dostępie z sieci adresy IP i nazwy hostów
   * wskazane przez administratora, ta sama strona (Origin = Host), bez funkcji komputera
   * serwera dla połączeń z sieci.
   */
  guard(localOnlyRoute: (req: Request) => boolean): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (!this.isBrowserSocket(req.socket)) {
        next();
        return;
      }
      const local = isLoopbackAddress(req.socket.remoteAddress);
      const host = hostName(req.get("host"));
      if (!local && this.mode !== "NETWORK") {
        res.status(403).json({ error: "NETWORK_ACCESS_DISABLED" });
        return;
      }
      const hostAllowed =
        LOOPBACK_HOSTS.has(host) ||
        (this.mode === "NETWORK" && (isIpLiteral(host) || allowedHostNames(this.publicBaseUrl).has(host)));
      if (!hostAllowed) {
        res.status(403).json({ error: "HOST_NOT_ALLOWED" });
        return;
      }
      if (DESKTOP_WINDOW_ONLY.some((rule) => rule.test(req.path)) || (!local && localOnlyRoute(req))) {
        res.status(403).json({ error: "NOT_AVAILABLE_IN_BROWSER" });
        return;
      }
      const origin = req.get("origin");
      if (origin) {
        try {
          if (new URL(origin).host.toLowerCase() === (req.get("host") ?? "").toLowerCase()) {
            (req as unknown as Record<symbol, boolean>)[BROWSER_SAME_ORIGIN] = true;
          }
        } catch {
          // Niepoprawny Origin rozstrzyga dalsza kontrola pochodzenia.
        }
      }
      next();
    };
  }
}

/** Żądanie strony aplikacji z tego samego adresu (Origin = Host) na kanale przeglądarki. */
export function browserSameOrigin(req: Request): boolean {
  return (req as unknown as Record<symbol, boolean | undefined>)[BROWSER_SAME_ORIGIN] === true;
}
