import { GoogleIntegrationError } from "./recovery-controller.js";
// Gmail read-only (gmail.readonly): the user searches with Gmail's own operators
// ("filename:pdf", "from:", "after:") and picks threads; a picked thread goes into the case as
// one text file of its messages and a file per attachment.
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_FILES_PER_THREAD = 40;
async function get(fetchImpl, token, url) {
    let response;
    try {
        response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    }
    catch {
        throw new GoogleIntegrationError("GOOGLE_NETWORK_ERROR", 502);
    }
    if (response.status === 401 || response.status === 403)
        throw new GoogleIntegrationError("GOOGLE_GMAIL_ACCESS_DENIED", 403);
    if (!response.ok)
        throw new GoogleIntegrationError("GOOGLE_GMAIL_FAILED", 502);
    return (await response.json());
}
const header = (part, name) => part?.headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
const decode = (data) => Buffer.from(data.replace(/-/gu, "+").replace(/_/gu, "/"), "base64");
export async function searchGmailThreads(fetchImpl, token, query, pageToken) {
    const url = new URL(`${API}/threads`);
    url.searchParams.set("maxResults", "20");
    if (query.trim())
        url.searchParams.set("q", query.trim().slice(0, 500));
    if (pageToken)
        url.searchParams.set("pageToken", pageToken);
    const list = await get(fetchImpl, token, url.toString());
    const ids = (Array.isArray(list.threads) ? list.threads : []).map((item) => String(item.id ?? "")).filter(Boolean);
    const threads = await Promise.all(ids.map(async (id) => {
        const meta = new URL(`${API}/threads/${encodeURIComponent(id)}`);
        meta.searchParams.set("format", "metadata");
        for (const name of ["Subject", "From", "Date"])
            meta.searchParams.append("metadataHeaders", name);
        const thread = await get(fetchImpl, token, meta.toString());
        const messages = (Array.isArray(thread.messages) ? thread.messages : []);
        const first = messages[0]?.payload;
        const last = messages.at(-1);
        return {
            id,
            subject: header(first, "Subject") || "(bez tematu)",
            from: header(first, "From"),
            date: header(last?.payload, "Date"),
            snippet: String(last?.snippet ?? ""),
            messages: messages.length
        };
    }));
    return { threads, ...(typeof list.nextPageToken === "string" ? { nextPageToken: list.nextPageToken } : {}) };
}
function walk(part, visit) {
    if (!part)
        return;
    visit(part);
    for (const child of part.parts ?? [])
        walk(child, visit);
}
function messageText(payload) {
    let plain = "";
    let html = "";
    walk(payload, (part) => {
        if (part.filename || !part.body?.data)
            return;
        if (part.mimeType === "text/plain" && !plain)
            plain = decode(part.body.data).toString("utf8");
        if (part.mimeType === "text/html" && !html)
            html = decode(part.body.data).toString("utf8");
    });
    if (plain)
        return plain.trim();
    return html
        .replace(/<(?:br|\/p|\/div|\/li|\/tr)[^>]*>/giu, "\n")
        .replace(/<[^>]+>/gu, "")
        .replace(/&nbsp;/gu, " ")
        .replace(/&amp;/gu, "&")
        .replace(/&lt;/gu, "<")
        .replace(/&gt;/gu, ">")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}
const safeName = (value) => value.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120) || "plik";
/** One picked thread as files: its messages in one text file, then each attachment. */
export async function gmailThreadFiles(fetchImpl, token, threadId) {
    const url = new URL(`${API}/threads/${encodeURIComponent(threadId)}`);
    url.searchParams.set("format", "full");
    const thread = await get(fetchImpl, token, url.toString());
    const messages = (Array.isArray(thread.messages) ? thread.messages : []);
    if (!messages.length)
        throw new GoogleIntegrationError("GOOGLE_GMAIL_THREAD_EMPTY", 404);
    const subject = header(messages[0].payload, "Subject") || "(bez tematu)";
    const text = messages
        .map((message) => [
        `Od: ${header(message.payload, "From")}`,
        `Do: ${header(message.payload, "To")}`,
        ...(header(message.payload, "Cc") ? [`DW: ${header(message.payload, "Cc")}`] : []),
        `Data: ${header(message.payload, "Date")}`,
        `Temat: ${header(message.payload, "Subject")}`,
        "",
        messageText(message.payload)
    ].join("\n"))
        .join("\n\n----------------------------------------\n\n");
    const files = [
        { filename: `${safeName(subject)} (wątek Gmail).txt`, mediaType: "text/plain", data: new Uint8Array(Buffer.from(text, "utf8")) }
    ];
    for (const message of messages) {
        const attachments = [];
        walk(message.payload, (part) => {
            if (part.filename && part.body?.attachmentId && (part.body.size ?? 0) <= MAX_ATTACHMENT_BYTES)
                attachments.push(part);
        });
        for (const part of attachments) {
            if (files.length >= MAX_FILES_PER_THREAD)
                break;
            const body = await get(fetchImpl, token, `${API}/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`);
            if (typeof body.data !== "string")
                continue;
            files.push({ filename: safeName(part.filename), mediaType: part.mimeType || "application/octet-stream", data: new Uint8Array(decode(body.data)) });
        }
    }
    return files;
}
