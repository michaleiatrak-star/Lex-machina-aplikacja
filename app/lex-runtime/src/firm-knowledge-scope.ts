import { documentIdFromSha256 } from "./case-document-purge.js";
import type { CaseWorkspaceIndex, WorkspaceFolderPurpose } from "./case-workspace-store.js";

/**
 * Firm know-how in a conversation (user request 2026-11-09): not the whole library, only the
 * files and folders picked in the conversation and the folders the firm ticked as default
 * ("Domyślnie w rozmowie"). A folder brings its subfolders. Nothing picked and no default
 * folder: the firm library is not searched.
 */
export type FirmKnowledgeSelection = { folderIds: readonly string[]; itemIds: readonly string[] };

/** The folder's purpose, or the nearest parent's (a subfolder of "Orzeczenia" holds judgments). */
export function folderPurpose(index: Pick<CaseWorkspaceIndex, "folders">, folderId: string | null | undefined): WorkspaceFolderPurpose | null {
  const byId = new Map(index.folders.map((folder) => [folder.folderId, folder]));
  const seen = new Set<string>();
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && !seen.has(current.folderId)) {
    if (current.purpose) return current.purpose;
    seen.add(current.folderId);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

export function firmKnowledgeItems(index: Pick<CaseWorkspaceIndex, "folders" | "itemLocations">, selection: FirmKnowledgeSelection): Set<string> {
  const known = new Set(index.folders.map((folder) => folder.folderId));
  const roots = new Set([
    ...index.folders.filter((folder) => folder.chatDefault).map((folder) => folder.folderId),
    // The firm's rules apply in every conversation.
    ...index.folders.filter((folder) => folder.purpose === "RULES").map((folder) => folder.folderId),
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
    if (folderId && chosen.has(folderId)) items.add(itemId);
  }
  return items;
}

/**
 * The purpose of every firm document (doc_<sha256 prefix>) by the folder it lies in; documents
 * of general know-how are absent.
 */
export function firmDocumentPurposes(
  index: Pick<CaseWorkspaceIndex, "folders" | "itemLocations">,
  uploads: ReadonlyArray<{ uploadId: string; sha256: string }>
): Map<string, WorkspaceFolderPurpose> {
  const purposes = new Map<string, WorkspaceFolderPurpose>();
  for (const upload of uploads) {
    const purpose = folderPurpose(index, index.itemLocations[upload.uploadId]);
    if (!purpose) continue;
    try {
      purposes.set(documentIdFromSha256(upload.sha256), purpose);
    } catch {
      // not a processable upload
    }
  }
  return purposes;
}

/** The documents (doc_<sha256 prefix>) of the chosen uploads. */
export function firmKnowledgeDocumentIds(items: ReadonlySet<string>, uploads: ReadonlyArray<{ uploadId: string; sha256: string }>): Set<string> {
  const documents = new Set<string>();
  for (const upload of uploads) {
    if (!items.has(upload.uploadId)) continue;
    try {
      documents.add(documentIdFromSha256(upload.sha256));
    } catch {
      // not a processable upload
    }
  }
  return documents;
}

const FOLDER_ID = /^folder_[a-f0-9]{32}$/;
const UPLOAD_ID = /^upload_[a-f0-9]{32}$/;

export function parseFirmKnowledgeSelection(value: unknown): FirmKnowledgeSelection | null {
  if (value === undefined || value === null) return { folderIds: [], itemIds: [] };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { folderIds?: unknown; itemIds?: unknown };
  const list = (input: unknown, pattern: RegExp): string[] | null => {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > 200 || !input.every((item) => typeof item === "string" && pattern.test(item))) return null;
    return [...new Set(input as string[])];
  };
  const folderIds = list(record.folderIds, FOLDER_ID);
  const itemIds = list(record.itemIds, UPLOAD_ID);
  return folderIds && itemIds ? { folderIds, itemIds } : null;
}
