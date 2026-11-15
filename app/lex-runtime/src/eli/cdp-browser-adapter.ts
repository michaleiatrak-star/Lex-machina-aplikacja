import { LOCAL_BROWSER_URL } from "../browser-render.js";

/**
 * Server mode without Playwright (user 2026-11-15: the browser must be installable both in the
 * application and on the server): the bot check of a law source is tried in the browser for reading
 * pages (Chromium in Docker, Ustawienia > Wyszukiwarka internetowa), through the DevTools protocol.
 * The object has the few Playwright calls server-browser-session.ts uses, so that code is unchanged.
 */

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type SocketFactory = (url: string) => WebSocket;

class CdpPage {
  private next = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private loaded: (() => void) | null = null;

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      let message: { id?: number; method?: string; result?: unknown; error?: { message?: string } };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.method === "Page.loadEventFired") this.loaded?.();
      if (message.id === undefined) return;
      const call = this.pending.get(message.id);
      if (!call) return;
      this.pending.delete(message.id);
      if (message.error) call.reject(new Error(message.error.message ?? "CDP_ERROR"));
      else call.resolve(message.result);
    });
  }

  static async open(url: string, socket: SocketFactory): Promise<CdpPage> {
    const ws = socket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("BROWSER_SOCKET_ERROR")));
    });
    const page = new CdpPage(ws);
    await page.send("Page.enable");
    await page.send("Network.enable");
    return page;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.next += 1;
      this.pending.set(this.next, { resolve, reject });
      this.ws.send(JSON.stringify({ id: this.next, method, params }));
    });
  }

  async goto(url: string, options: { timeout: number }): Promise<void> {
    const load = new Promise<void>((done) => {
      this.loaded = done;
    });
    await this.send("Page.navigate", { url });
    await Promise.race([load, new Promise((done) => setTimeout(done, options.timeout))]);
  }

  async evaluateExpression<T>(expression: string): Promise<T> {
    const result = (await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as { result?: { value?: T } };
    return result.result?.value as T;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

export function cdpChromium(endpoint = LOCAL_BROWSER_URL, fetcher: Fetcher = (input, init) => fetch(input, init), socket: SocketFactory = (url) => new WebSocket(url)) {
  return {
    async launch() {
      const opened: Array<{ page: CdpPage; id: string }> = [];
      return {
        async newContext() {
          return {
            async newPage() {
              const created = await fetcher(`${endpoint}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) });
              if (!created.ok) throw new Error("BROWSER_TARGET_FAILED");
              const target = (await created.json()) as { id?: string };
              if (!target.id || !/^[A-Za-z0-9]+$/u.test(target.id)) throw new Error("BROWSER_TARGET_FAILED");
              // The container reports its own port (9222); the published one is this endpoint's.
              const page = await CdpPage.open(`${endpoint.replace(/^http/u, "ws")}/devtools/page/${target.id}`, socket);
              opened.push({ page, id: target.id });
              return {
                goto: (url: string, options: { waitUntil: string; timeout: number }) => page.goto(url, options),
                content: () => page.evaluateExpression<string>("document.documentElement ? document.documentElement.outerHTML : ''"),
                waitForTimeout: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
                evaluate: <T>(fn: () => T) => page.evaluateExpression<T>(`(${fn.toString()})()`)
              };
            },
            async cookies(url: string) {
              const page = opened.at(-1)?.page;
              if (!page) return [];
              const result = (await page.send("Network.getCookies", { urls: [url] })) as { cookies?: Array<{ name: string; value: string }> };
              return (result.cookies ?? []).map((item) => ({ name: item.name, value: item.value }));
            }
          };
        },
        async close() {
          for (const { page, id } of opened.splice(0)) {
            page.close();
            await fetcher(`${endpoint}/json/close/${id}`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
          }
        }
      };
    }
  };
}

/** The browser for reading pages answers (DevTools protocol). */
export async function cdpBrowserAvailable(endpoint = LOCAL_BROWSER_URL, fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<boolean> {
  try {
    return (await fetcher(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}
