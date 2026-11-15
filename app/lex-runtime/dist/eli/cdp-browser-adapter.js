import { LOCAL_BROWSER_URL } from "../browser-render.js";
class CdpPage {
    ws;
    next = 0;
    pending = new Map();
    loaded = null;
    constructor(ws) {
        this.ws = ws;
        ws.addEventListener("message", (event) => {
            let message;
            try {
                message = JSON.parse(String(event.data));
            }
            catch {
                return;
            }
            if (message.method === "Page.loadEventFired")
                this.loaded?.();
            if (message.id === undefined)
                return;
            const call = this.pending.get(message.id);
            if (!call)
                return;
            this.pending.delete(message.id);
            if (message.error)
                call.reject(new Error(message.error.message ?? "CDP_ERROR"));
            else
                call.resolve(message.result);
        });
    }
    static async open(url, socket) {
        const ws = socket(url);
        await new Promise((resolve, reject) => {
            ws.addEventListener("open", () => resolve());
            ws.addEventListener("error", () => reject(new Error("BROWSER_SOCKET_ERROR")));
        });
        const page = new CdpPage(ws);
        await page.send("Page.enable");
        await page.send("Network.enable");
        return page;
    }
    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            this.next += 1;
            this.pending.set(this.next, { resolve, reject });
            this.ws.send(JSON.stringify({ id: this.next, method, params }));
        });
    }
    async goto(url, options) {
        const load = new Promise((done) => {
            this.loaded = done;
        });
        await this.send("Page.navigate", { url });
        await Promise.race([load, new Promise((done) => setTimeout(done, options.timeout))]);
    }
    async evaluateExpression(expression) {
        const result = (await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }));
        return result.result?.value;
    }
    close() {
        try {
            this.ws.close();
        }
        catch {
            // already closed
        }
    }
}
export function cdpChromium(endpoint = LOCAL_BROWSER_URL, fetcher = (input, init) => fetch(input, init), socket = (url) => new WebSocket(url)) {
    return {
        async launch() {
            const opened = [];
            return {
                async newContext() {
                    return {
                        async newPage() {
                            const created = await fetcher(`${endpoint}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(5000) });
                            if (!created.ok)
                                throw new Error("BROWSER_TARGET_FAILED");
                            const target = (await created.json());
                            if (!target.id || !/^[A-Za-z0-9]+$/u.test(target.id))
                                throw new Error("BROWSER_TARGET_FAILED");
                            // The container reports its own port (9222); the published one is this endpoint's.
                            const page = await CdpPage.open(`${endpoint.replace(/^http/u, "ws")}/devtools/page/${target.id}`, socket);
                            opened.push({ page, id: target.id });
                            return {
                                goto: (url, options) => page.goto(url, options),
                                content: () => page.evaluateExpression("document.documentElement ? document.documentElement.outerHTML : ''"),
                                waitForTimeout: (ms) => new Promise((done) => setTimeout(done, ms)),
                                evaluate: (fn) => page.evaluateExpression(`(${fn.toString()})()`)
                            };
                        },
                        async cookies(url) {
                            const page = opened.at(-1)?.page;
                            if (!page)
                                return [];
                            const result = (await page.send("Network.getCookies", { urls: [url] }));
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
export async function cdpBrowserAvailable(endpoint = LOCAL_BROWSER_URL, fetcher = (input, init) => fetch(input, init)) {
    try {
        return (await fetcher(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1500) })).ok;
    }
    catch {
        return false;
    }
}
