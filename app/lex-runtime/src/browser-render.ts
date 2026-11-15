/**
 * A browser on this computer for reading pages (user 2026-11-15): Chromium in Docker next to the
 * local SearXNG (chromedp/headless-shell, the DevTools protocol on 127.0.0.1 only). A page built
 * by JavaScript (eureka.mf.gov.pl, court portals) or behind a simple bot check gives its text
 * to the application's page reader (fetch_auxiliary_legal_source) through it. No extra library:
 * the DevTools protocol over Node's WebSocket.
 */
export const LOCAL_BROWSER_PORT = 9223;
export const LOCAL_BROWSER_URL = `http://127.0.0.1:${LOCAL_BROWSER_PORT}`;

export type RenderedPage = { text: string; title: string; finalUrl: string };

export interface PageRenderer {
  render(url: string, timeoutMs?: number): Promise<RenderedPage | null>;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type SocketFactory = (url: string) => WebSocket;

export class CdpPageRenderer implements PageRenderer {
  private unavailableUntil = 0;

  constructor(
    private readonly endpoint = LOCAL_BROWSER_URL,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly socket: SocketFactory = (url) => new WebSocket(url)
  ) {}

  /** Whether the browser answers; a missing one is not asked again for a minute. */
  async available(): Promise<boolean> {
    if (Date.now() < this.unavailableUntil) return false;
    try {
      const response = await this.fetcher(`${this.endpoint}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // not running
    }
    this.unavailableUntil = Date.now() + 60_000;
    return false;
  }

  async render(url: string, timeoutMs = 25_000): Promise<RenderedPage | null> {
    if (!(await this.available())) return null;
    const created = await this.fetcher(`${this.endpoint}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) });
    if (!created.ok) return null;
    const target = (await created.json()) as { id?: string };
    if (!target.id || !/^[A-Za-z0-9]+$/u.test(target.id)) return null;
    // The container reports its own port (9222); the published one is this endpoint's.
    const ws = this.socket(`${this.endpoint.replace(/^http/u, "ws")}/devtools/page/${target.id}`);
    try {
      return await new Promise<RenderedPage | null>((resolve, reject) => {
        let next = 0;
        const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
        let loaded: (() => void) | null = null;
        const send = (method: string, params: Record<string, unknown> = {}) =>
          new Promise<unknown>((ok, fail) => {
            next += 1;
            pending.set(next, { resolve: ok, reject: fail });
            ws.send(JSON.stringify({ id: next, method, params }));
          });
        const timer = setTimeout(() => reject(new Error("BROWSER_RENDER_TIMEOUT")), timeoutMs);
        ws.addEventListener("message", (event) => {
          let message: { id?: number; method?: string; result?: unknown; error?: { message?: string } };
          try {
            message = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (message.method === "Page.loadEventFired") loaded?.();
          if (message.id === undefined) return;
          const call = pending.get(message.id);
          if (!call) return;
          pending.delete(message.id);
          if (message.error) call.reject(new Error(message.error.message ?? "CDP_ERROR"));
          else call.resolve(message.result);
        });
        ws.addEventListener("error", () => reject(new Error("BROWSER_SOCKET_ERROR")));
        ws.addEventListener("open", () => {
          void (async () => {
            const load = new Promise<void>((done) => {
              loaded = done;
            });
            await send("Page.enable");
            await send("Page.navigate", { url });
            await Promise.race([load, new Promise((done) => setTimeout(done, Math.max(1000, timeoutMs - 6000)))]);
            // Pages that fill themselves in after the load event (search results, SPA).
            await new Promise((done) => setTimeout(done, 1500));
            const result = (await send("Runtime.evaluate", {
              expression: "JSON.stringify({ title: document.title, url: location.href, text: document.body ? document.body.innerText : '' })",
              returnByValue: true
            })) as { result?: { value?: string } };
            const page = JSON.parse(result.result?.value ?? "{}") as { title?: string; url?: string; text?: string };
            clearTimeout(timer);
            resolve({ text: (page.text ?? "").trim(), title: page.title ?? "", finalUrl: page.url ?? url });
          })().catch((error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        });
      });
    } finally {
      try {
        ws.close();
      } catch {
        // already closed
      }
      await this.fetcher(`${this.endpoint}/json/close/${target.id}`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
    }
  }
}

let configured: PageRenderer | null = null;

/** The renderer the page reader uses (set by the server; none in tests). */
export function configurePageRenderer(renderer: PageRenderer | null): void {
  configured = renderer;
}

export function pageRenderer(): PageRenderer | null {
  return configured;
}
