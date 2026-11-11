import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
/**
 * Court sites that send their certificate without the intermediate one. A browser fetches the
 * missing intermediate from the address the certificate names (Authority Information Access);
 * Node does not and fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE ("TypeError" in the register,
 * user report 2026-11-11). This does what the browser does: it reads that address, downloads
 * the intermediate and connects again with it, still verified against the system's roots.
 */
const INCOMPLETE_CHAIN = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"]);
const intermediates = new Map();
const TIMEOUT_MS = 20_000;
export function errorCode(error) {
    const cause = error?.cause;
    if (cause && typeof cause.code === "string")
        return cause.code;
    const code = error?.code;
    return typeof code === "string" ? code : "";
}
export function isIncompleteChain(error) {
    return INCOMPLETE_CHAIN.has(errorCode(error));
}
/** The reason shown in the register for a request that got no answer. */
export function networkReason(error) {
    const code = errorCode(error);
    if (INCOMPLETE_CHAIN.has(code))
        return "niekompletny certyfikat strony sądu";
    if (/^CERT_|_CERT|SELF_SIGNED|DEPTH_ZERO/u.test(code))
        return `certyfikat strony sądu (${code})`;
    if (code === "ENOTFOUND" || code === "EAI_AGAIN")
        return "adres strony sądu nie istnieje (DNS)";
    if (code === "ECONNREFUSED")
        return "strona sądu odmówiła połączenia";
    if (code === "ECONNRESET" || code === "UND_ERR_SOCKET")
        return "strona sądu zerwała połączenie";
    if (code === "UND_ERR_CONNECT_TIMEOUT" || error?.name === "TimeoutError")
        return "przekroczony czas odpowiedzi";
    return code || (error instanceof Error ? error.name : "błąd sieci");
}
function issuerAddress(host) {
    return new Promise((resolve) => {
        const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: TIMEOUT_MS }, () => {
            // Only to read where the issuer certificate is published; nothing is sent over it.
            const access = socket.getPeerCertificate().infoAccess?.["CA Issuers - URI"]?.[0] ?? null;
            socket.end();
            resolve(access && /^https?:\/\//iu.test(access) ? access : null);
        });
        socket.on("error", () => resolve(null));
        socket.on("timeout", () => {
            socket.destroy();
            resolve(null);
        });
    });
}
function download(url) {
    return new Promise((resolve) => {
        const client = url.startsWith("https:") ? https : http;
        const request = client.get(url, { timeout: TIMEOUT_MS }, (response) => {
            if ((response.statusCode ?? 0) !== 200) {
                response.resume();
                resolve(null);
                return;
            }
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
                size += chunk.length;
                if (size > 64 * 1024)
                    request.destroy();
                else
                    chunks.push(chunk);
            });
            response.on("end", () => resolve(Buffer.concat(chunks)));
            response.on("error", () => resolve(null));
        });
        request.on("error", () => resolve(null));
        request.on("timeout", () => request.destroy());
    });
}
/** The missing intermediate of the host as PEM (cached), or null. */
export async function missingIntermediate(host) {
    const cached = intermediates.get(host);
    if (cached)
        return cached;
    const address = await issuerAddress(host);
    if (!address)
        return null;
    const body = await download(address);
    if (!body)
        return null;
    try {
        const pem = new X509Certificate(body).toString();
        intermediates.set(host, pem);
        return pem;
    }
    catch {
        return null;
    }
}
/**
 * A request with the intermediate added to the trusted roots; https redirects followed (as GET,
 * as fetch does after a form POST).
 */
export function requestWithIntermediate(url, intermediate, headers, init, redirects = 5) {
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method: init?.method ?? "GET",
            headers: init ? { ...headers, "content-length": String(Buffer.byteLength(init.body)) } : headers,
            ca: [...tls.rootCertificates, intermediate],
            timeout: TIMEOUT_MS
        }, (response) => {
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if (status >= 300 && status < 400 && location && redirects > 0) {
                response.resume();
                const next = new URL(location, url).toString();
                if (!next.startsWith("https://")) {
                    reject(new Error("WOKANDA_REDIRECT_NOT_HTTPS"));
                    return;
                }
                requestWithIntermediate(next, intermediate, headers, undefined, redirects - 1).then(resolve, reject);
                return;
            }
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
                size += chunk.length;
                if (size <= 1_000_000)
                    chunks.push(chunk);
            });
            response.on("end", () => resolve({ status, url, text: Buffer.concat(chunks).toString("utf8") }));
            response.on("error", reject);
        });
        request.on("error", reject);
        request.on("timeout", () => request.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
        request.end(init?.body);
    });
}
