import { t } from "./i18n";
import { useEffect, useMemo, useState } from "react";
import { getWorkspace, type WorkspaceResponse } from "./workspace-client.js";

export type FirmKnowledgeSelection = { folderIds: string[]; itemIds: string[] };

/**
 * Firm know-how in a conversation: only the folders and files picked here and the folders the
 * firm ticked as default ("domyślnie w rozmowie", shown ticked and fixed). A folder brings its
 * subfolders and files. Nothing picked and no default folder: the library is not searched.
 */
export function FirmKnowledgePicker({
  firmCaseId,
  selection,
  onChange,
  disabled
}: {
  firmCaseId: string;
  selection: FirmKnowledgeSelection;
  onChange: (next: FirmKnowledgeSelection) => void;
  disabled: boolean;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getWorkspace(firmCaseId)
      .then((result) => {
        if (!cancelled) setWorkspace(result);
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [firmCaseId]);

  const folders = workspace?.folders ?? [];
  const depth = (folderId: string | null): number => {
    let level = 0;
    let current = folders.find((folder) => folder.folderId === folderId);
    while (current?.parentId && level < 12) {
      level += 1;
      current = folders.find((folder) => folder.folderId === current!.parentId);
    }
    return level;
  };
  // A folder is covered by a default or picked ancestor (itself included).
  const covered = useMemo(() => {
    const roots = new Set([...folders.filter((folder) => folder.chatDefault).map((folder) => folder.folderId), ...selection.folderIds]);
    const all = new Set(roots);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of folders) {
        if (folder.parentId && all.has(folder.parentId) && !all.has(folder.folderId)) {
          all.add(folder.folderId);
          grew = true;
        }
      }
    }
    return all;
  }, [folders, selection.folderIds]);
  const files = (workspace?.items ?? []).filter((item) => item.kind === "UPLOAD");
  const locationOf = (itemId: string) => workspace?.itemLocations[itemId] ?? null;
  const defaults = folders.filter((folder) => folder.chatDefault).length;
  const coveredFiles = files.filter((file) => {
    const folder = locationOf(file.itemId);
    return (folder && covered.has(folder)) || selection.itemIds.includes(file.itemId);
  }).length;

  const toggle = (list: "folderIds" | "itemIds", id: string, on: boolean) =>
    onChange({ ...selection, [list]: on ? [...new Set([...selection[list], id])] : selection[list].filter((value) => value !== id) });

  if (error) return <small className="firm-picker-note">{t("Nie udało się wczytać bazy know-how (")}{error}).</small>;
  if (!workspace) return <small className="firm-picker-note">{t("Wczytywanie bazy know-how…")}</small>;

  return (
    <details className="firm-picker">
      <summary>
        {t("Materiały do tej rozmowy:")} {coveredFiles} z {files.length} {t("plików")}
        {defaults ? t(" · domyślne foldery kancelarii: {defaults}", { defaults: defaults }) : ""}
      </summary>
      {folders.length === 0 && files.length === 0 ? <small className="firm-picker-note">{t("Baza know-how jest pusta.")}</small> : null}
      <ul className="firm-picker-list">
        {folders.map((folder) => {
          const fixed = folder.chatDefault === true;
          const inherited = !fixed && !selection.folderIds.includes(folder.folderId) && covered.has(folder.folderId);
          return (
            <li key={folder.folderId} style={{ paddingLeft: `${depth(folder.folderId) * 16}px` }}>
              <label>
                <input
                  type="checkbox"
                  checked={covered.has(folder.folderId)}
                  disabled={disabled || fixed || inherited}
                  onChange={(event) => toggle("folderIds", folder.folderId, event.target.checked)}
                />
                <span>📁 {folder.name}</span>
                {fixed ? <small>{t("domyślny kancelarii")}</small> : inherited ? <small>{t("w wybranym folderze")}</small> : null}
              </label>
            </li>
          );
        })}
        {files.map((file) => {
          const folder = locationOf(file.itemId);
          const inFolder = Boolean(folder && covered.has(folder));
          return (
            <li key={file.itemId} style={{ paddingLeft: `${(folder ? depth(folder) + 1 : 0) * 16}px` }}>
              <label>
                <input
                  type="checkbox"
                  checked={inFolder || selection.itemIds.includes(file.itemId)}
                  disabled={disabled || inFolder}
                  onChange={(event) => toggle("itemIds", file.itemId, event.target.checked)}
                />
                <span>{file.filename}</span>
                {folder ? <small>{folders.find((item) => item.folderId === folder)?.name}</small> : null}
              </label>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
