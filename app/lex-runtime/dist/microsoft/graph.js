import { GRAPH } from "./config.js";
import { MicrosoftIntegrationError } from "./oauth.js";
// Microsoft Graph, read-only: OneDrive, files shared with the user, SharePoint document
// libraries. An item is addressed as "<driveId>~<itemId>" (a drive's root: "<driveId>~root").
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_DEPTH = 3;
const PART = /^[A-Za-z0-9!._-]{1,300}$/u;
export function itemRef(id) {
    const [driveId, itemId, extra] = id.split("~");
    if (!driveId || !itemId || extra !== undefined || !PART.test(driveId) || !PART.test(itemId)) {
        throw new MicrosoftIntegrationError("MICROSOFT_ITEM_ID_INVALID", 400);
    }
    return { driveId, itemId };
}
async function call(fetchImpl, token, url) {
    if (!url.startsWith(`${GRAPH}/`))
        throw new MicrosoftIntegrationError("MICROSOFT_URL_INVALID", 400);
    let response;
    try {
        // A hung connection must not hold the chat turn that asked for the file (downloads included).
        response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(300_000) });
    }
    catch {
        throw new MicrosoftIntegrationError("MICROSOFT_NETWORK_ERROR", 502);
    }
    if (response.status === 401 || response.status === 403)
        throw new MicrosoftIntegrationError("MICROSOFT_ACCESS_DENIED", 403);
    if (response.status === 404)
        throw new MicrosoftIntegrationError("MICROSOFT_ITEM_NOT_FOUND", 404);
    if (!response.ok)
        throw new MicrosoftIntegrationError("MICROSOFT_GRAPH_FAILED", 502);
    return response;
}
function driveItem(raw) {
    // Shared with me: the item lives in another drive (remoteItem).
    const remote = raw.remoteItem;
    const source = remote ?? raw;
    const parent = (source.parentReference ?? raw.parentReference);
    const driveId = typeof parent?.driveId === "string" ? parent.driveId : "";
    const id = typeof source.id === "string" ? source.id : "";
    if (!driveId || !id || !PART.test(driveId) || !PART.test(id))
        return null;
    const folder = Boolean(source.folder ?? raw.folder);
    const file = (source.file ?? raw.file);
    // OneNote notebooks, packages and the like: neither file nor folder.
    if (!folder && !file)
        return null;
    return {
        id: `${driveId}~${id}`,
        name: String(raw.name ?? source.name ?? ""),
        folder,
        kind: folder ? "folder" : "file",
        ...(typeof source.size === "number" && !folder ? { size: source.size } : {}),
        ...(typeof source.lastModifiedDateTime === "string" ? { modified: source.lastModifiedDateTime } : {}),
        ...(typeof file?.mimeType === "string" ? { mediaType: file.mimeType } : {})
    };
}
const SELECT = "$select=id,name,folder,file,size,lastModifiedDateTime,parentReference,remoteItem";
async function page(fetchImpl, token, url) {
    const json = (await (await call(fetchImpl, token, url)).json());
    const items = (Array.isArray(json.value) ? json.value : [])
        .map((value) => driveItem(value))
        .filter((item) => item !== null);
    const next = typeof json["@odata.nextLink"] === "string" ? json["@odata.nextLink"] : undefined;
    return { items, ...(next && next.startsWith(`${GRAPH}/`) ? { next } : {}) };
}
/**
 * One level: "onedrive" (the user's OneDrive root), "shared" (shared with the user), "sites"
 * (SharePoint sites found by `query`), a site's libraries ("site:<siteId>"), a folder
 * ("<driveId>~<itemId>"), or a search of the user's OneDrive by name (`query` without a place).
 */
export async function listGraph(fetchImpl, token, options) {
    if (options.next)
        return await page(fetchImpl, token, options.next);
    const place = options.place ?? "onedrive";
    const query = options.query?.trim().slice(0, 200) ?? "";
    if (place === "sites") {
        const url = `${GRAPH}/sites?search=${encodeURIComponent(query || "*")}&$select=id,displayName,webUrl,lastModifiedDateTime`;
        const json = (await (await call(fetchImpl, token, url)).json());
        return {
            items: (json.value ?? [])
                .filter((site) => typeof site.id === "string" && /^[A-Za-z0-9.,_-]{1,400}$/u.test(site.id))
                .map((site) => ({ id: `site:${site.id}`, name: String(site.displayName ?? site.webUrl ?? ""), folder: true, kind: "site" }))
        };
    }
    if (place.startsWith("site:")) {
        const siteId = place.slice(5);
        if (!/^[A-Za-z0-9.,_-]{1,400}$/u.test(siteId))
            throw new MicrosoftIntegrationError("MICROSOFT_ITEM_ID_INVALID", 400);
        const json = (await (await call(fetchImpl, token, `${GRAPH}/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,driveType`)).json());
        return {
            items: (json.value ?? [])
                .filter((drive) => typeof drive.id === "string" && PART.test(drive.id))
                .map((drive) => ({ id: `${drive.id}~root`, name: String(drive.name ?? ""), folder: true, kind: "library" }))
        };
    }
    if (place === "shared")
        return await page(fetchImpl, token, `${GRAPH}/me/drive/sharedWithMe?${SELECT}`);
    if (place === "onedrive") {
        if (query) {
            return await page(fetchImpl, token, `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(query.replace(/'/gu, "''"))}')?${SELECT}&$top=50`);
        }
        return await page(fetchImpl, token, `${GRAPH}/me/drive/root/children?${SELECT}&$top=100`);
    }
    const { driveId, itemId } = itemRef(place);
    return await page(fetchImpl, token, `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?${SELECT}&$top=100`);
}
const safeName = (value) => value.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 150) || "plik";
/** A picked file, or the files of a picked folder (three levels down, at most 100 files of 50 MB). */
export async function graphFiles(fetchImpl, token, id) {
    const files = [];
    const visit = async (ref, prefix, depth) => {
        if (files.length >= MAX_FILES)
            return;
        const base = `${GRAPH}/drives/${encodeURIComponent(ref.driveId)}/items/${encodeURIComponent(ref.itemId)}`;
        const meta = (await (await call(fetchImpl, token, `${base}?$select=id,name,folder,file,size`)).json());
        const name = safeName(String(meta.name ?? ref.itemId));
        if (meta.folder) {
            if (depth >= MAX_DEPTH)
                return;
            let next = `${base}/children?${SELECT}&$top=100`;
            while (next && files.length < MAX_FILES) {
                const listing = await page(fetchImpl, token, next);
                for (const item of listing.items)
                    await visit(itemRef(item.id), `${prefix}${name} - `, depth + 1);
                next = listing.next;
            }
            return;
        }
        const file = meta.file;
        if (!file || Number(meta.size ?? 0) > MAX_FILE_BYTES)
            return;
        // 302 to a pre-authenticated download address; the token is not sent to that host.
        const response = await call(fetchImpl, token, `${base}/content`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > MAX_FILE_BYTES)
            return;
        files.push({ filename: `${prefix}${name}`, mediaType: typeof file.mimeType === "string" ? file.mimeType : "application/octet-stream", data });
    };
    await visit(itemRef(id), "", 0);
    return files;
}
