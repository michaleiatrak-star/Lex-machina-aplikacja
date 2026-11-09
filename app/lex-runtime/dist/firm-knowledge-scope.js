import { documentIdFromSha256 } from "./case-document-purge.js";
export function firmKnowledgeItems(index, selection) {
    const known = new Set(index.folders.map((folder) => folder.folderId));
    const roots = new Set([
        ...index.folders.filter((folder) => folder.chatDefault).map((folder) => folder.folderId),
        ...selection.folderIds.filter((folderId) => known.has(folderId))
    ]);
    // Subfolders of a chosen folder are chosen too.
    const chosen = new Set(roots);
    let grew = true;
    while (grew) {
        grew = false;
        for (const folder of index.folders) {
            if (folder.parentId && chosen.has(folder.parentId) && !chosen.has(folder.folderId)) {
                chosen.add(folder.folderId);
                grew = true;
            }
        }
    }
    const items = new Set(selection.itemIds);
    for (const [itemId, folderId] of Object.entries(index.itemLocations)) {
        if (folderId && chosen.has(folderId))
            items.add(itemId);
    }
    return items;
}
/** The documents (doc_<sha256 prefix>) of the chosen uploads. */
export function firmKnowledgeDocumentIds(items, uploads) {
    const documents = new Set();
    for (const upload of uploads) {
        if (!items.has(upload.uploadId))
            continue;
        try {
            documents.add(documentIdFromSha256(upload.sha256));
        }
        catch {
            // not a processable upload
        }
    }
    return documents;
}
const FOLDER_ID = /^folder_[a-f0-9]{32}$/;
const UPLOAD_ID = /^upload_[a-f0-9]{32}$/;
export function parseFirmKnowledgeSelection(value) {
    if (value === undefined || value === null)
        return { folderIds: [], itemIds: [] };
    if (typeof value !== "object" || Array.isArray(value))
        return null;
    const record = value;
    const list = (input, pattern) => {
        if (input === undefined)
            return [];
        if (!Array.isArray(input) || input.length > 200 || !input.every((item) => typeof item === "string" && pattern.test(item)))
            return null;
        return [...new Set(input)];
    };
    const folderIds = list(record.folderIds, FOLDER_ID);
    const itemIds = list(record.itemIds, UPLOAD_ID);
    return folderIds && itemIds ? { folderIds, itemIds } : null;
}
