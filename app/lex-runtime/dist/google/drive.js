import { GoogleIntegrationError } from "./recovery-controller.js";
// Drive read-only (drive.readonly): the user browses folders or searches by name and picks
// files or a whole folder; Google documents are exported to Office formats the case reads.
const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_DEPTH = 3;
// Google's own formats: exported, the others downloaded as they are.
const EXPORTS = {
    "application/vnd.google-apps.document": { mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" },
    "application/vnd.google-apps.spreadsheet": { mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
    "application/vnd.google-apps.presentation": { mediaType: "application/pdf", extension: "pdf" },
    "application/vnd.google-apps.drawing": { mediaType: "application/pdf", extension: "pdf" }
};
async function call(fetchImpl, token, url) {
    let response;
    try {
        response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
    }
    catch {
        throw new GoogleIntegrationError("GOOGLE_NETWORK_ERROR", 502);
    }
    if (response.status === 401 || response.status === 403)
        throw new GoogleIntegrationError("GOOGLE_DRIVE_ACCESS_DENIED", 403);
    if (!response.ok)
        throw new GoogleIntegrationError("GOOGLE_DRIVE_FAILED", 502);
    return response;
}
const quote = (value) => value.replace(/\\/gu, "\\\\").replace(/'/gu, "\\'");
export async function listDrive(fetchImpl, token, options) {
    const url = new URL(API);
    const folder = options.folderId && /^[A-Za-z0-9_-]{1,200}$/u.test(options.folderId) ? options.folderId : "root";
    url.searchParams.set("q", options.query?.trim() ? `name contains '${quote(options.query.trim().slice(0, 200))}' and trashed = false` : `'${folder}' in parents and trashed = false`);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime)");
    url.searchParams.set("pageSize", "50");
    url.searchParams.set("orderBy", "folder,name");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (options.pageToken)
        url.searchParams.set("pageToken", options.pageToken);
    const json = (await (await call(fetchImpl, token, url.toString())).json());
    const items = (Array.isArray(json.files) ? json.files : []).map((file) => {
        const raw = file;
        const mimeType = String(raw.mimeType ?? "");
        return {
            id: String(raw.id ?? ""),
            name: String(raw.name ?? ""),
            mimeType,
            folder: mimeType === FOLDER,
            ...(raw.size !== undefined ? { size: Number(raw.size) } : {}),
            ...(typeof raw.modifiedTime === "string" ? { modifiedTime: raw.modifiedTime } : {})
        };
    });
    return { items, ...(typeof json.nextPageToken === "string" ? { nextPageToken: json.nextPageToken } : {}) };
}
const safeName = (value) => value.replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 150) || "plik";
/** A picked file, or the files of a picked folder (three levels down, at most 100 files). */
export async function driveFiles(fetchImpl, token, fileId) {
    if (!/^[A-Za-z0-9_-]{1,200}$/u.test(fileId))
        throw new GoogleIntegrationError("GOOGLE_DRIVE_ID_INVALID", 400);
    const files = [];
    const visit = async (id, prefix, depth) => {
        if (files.length >= MAX_FILES)
            return;
        const metaUrl = new URL(`${API}/${encodeURIComponent(id)}`);
        metaUrl.searchParams.set("fields", "id,name,mimeType,size");
        metaUrl.searchParams.set("supportsAllDrives", "true");
        const meta = (await (await call(fetchImpl, token, metaUrl.toString())).json());
        const name = safeName(meta.name ?? id);
        if (meta.mimeType === FOLDER) {
            if (depth >= MAX_DEPTH)
                return;
            let pageToken;
            do {
                const page = await listDrive(fetchImpl, token, { folderId: id, ...(pageToken ? { pageToken } : {}) });
                for (const item of page.items)
                    await visit(item.id, `${prefix}${name} - `, depth + 1);
                pageToken = page.nextPageToken;
            } while (pageToken && files.length < MAX_FILES);
            return;
        }
        const exported = EXPORTS[meta.mimeType ?? ""];
        if (!exported && (meta.mimeType ?? "").startsWith("application/vnd.google-apps."))
            return; // forms, sites, shortcuts
        if (!exported && Number(meta.size ?? 0) > MAX_FILE_BYTES)
            return;
        const url = new URL(exported ? `${API}/${encodeURIComponent(id)}/export` : `${API}/${encodeURIComponent(id)}`);
        if (exported)
            url.searchParams.set("mimeType", exported.mediaType);
        else
            url.searchParams.set("alt", "media");
        url.searchParams.set("supportsAllDrives", "true");
        const data = new Uint8Array(await (await call(fetchImpl, token, url.toString())).arrayBuffer());
        if (data.byteLength > MAX_FILE_BYTES)
            return;
        files.push({
            filename: `${prefix}${exported && !name.toLowerCase().endsWith(`.${exported.extension}`) ? `${name}.${exported.extension}` : name}`,
            mediaType: exported?.mediaType ?? meta.mimeType ?? "application/octet-stream",
            data
        });
    };
    await visit(fileId, "", 0);
    return files;
}
