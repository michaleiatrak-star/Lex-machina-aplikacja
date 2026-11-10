import { t, N_ } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { blocksFromDom, withExtension, type NodeLike } from "./office-editing.js";
import { editedFilename } from "./text-editing.js";
import type { EditableBlock, EditableRun } from "./workspace-client.js";
import { InfoTip } from "./InfoTip";

function appendRuns(parent: HTMLElement, runs: EditableRun[]): void {
  for (const run of runs) {
    let node: Node = document.createTextNode(run.text);
    // Nested tags, never markup from the file: text always goes in as text.
    if (run.u) node = wrap("u", node);
    if (run.i) node = wrap("i", node);
    if (run.b) node = wrap("b", node);
    parent.appendChild(node);
  }
  if (!parent.childNodes.length) parent.appendChild(document.createElement("br"));
}

function wrap(tag: string, child: Node): HTMLElement {
  const element = document.createElement(tag);
  element.appendChild(child);
  return element;
}

function renderBlocks(root: HTMLElement, blocks: EditableBlock[]): void {
  root.replaceChildren();
  for (const block of blocks) {
    if (block.type === "heading") {
      const heading = document.createElement(`h${Math.min(Math.max(block.level, 1), 3)}`);
      appendRuns(heading, block.runs);
      root.appendChild(heading);
    } else if (block.type === "paragraph") {
      const paragraph = document.createElement("p");
      appendRuns(paragraph, block.runs);
      root.appendChild(paragraph);
    } else if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const li = document.createElement("li");
        appendRuns(li, item);
        list.appendChild(li);
      }
      root.appendChild(list);
    } else {
      const table = document.createElement("table");
      const body = document.createElement("tbody");
      for (const row of block.rows) {
        const tr = document.createElement("tr");
        for (const cell of row) {
          const td = document.createElement("td");
          td.textContent = cell;
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      table.appendChild(body);
      root.appendChild(table);
    }
  }
  if (!root.childNodes.length) {
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    root.appendChild(paragraph);
  }
}

type Command =
  | { label: string; title: string; command: string; value?: string };

const COMMANDS: Command[] = [
  { label: "B", title: "Pogrubienie (Ctrl+B)", command: "bold" },
  { label: "I", title: N_("Kursywa (Ctrl+I)"), command: "italic" },
  { label: "U", title: N_("Podkreślenie (Ctrl+U)"), command: "underline" },
  { label: N_("Tekst"), title: N_("Zwykły akapit"), command: "formatBlock", value: "p" },
  { label: "H1", title: N_("Nagłówek 1"), command: "formatBlock", value: "h1" },
  { label: "H2", title: N_("Nagłówek 2"), command: "formatBlock", value: "h2" },
  { label: "H3", title: N_("Nagłówek 3"), command: "formatBlock", value: "h3" },
  { label: "• Lista", title: "Lista punktowana", command: "insertUnorderedList" },
  { label: "1. Lista", title: "Lista numerowana", command: "insertOrderedList" },
  { label: N_("Cofnij"), title: N_("Cofnij (Ctrl+Z)"), command: "undo" },
  { label: N_("Ponów"), title: N_("Ponów (Ctrl+Y)"), command: "redo" }
];

export function DocumentEditor(props: {
  filename: string;
  format: "docx" | "odt";
  blocks: EditableBlock[];
  readOnly: boolean;
  onSave: (filename: string, format: "docx" | "odt" | "pdf", blocks: EditableBlock[], options: { trackChanges?: boolean }) => Promise<void>;
  // Other uses of the edited text (e.g. a pleading's draft in its pipeline); each
  // resolves to the status shown to the user.
  extraActions?: Array<{ label: string; title?: string; run: (blocks: EditableBlock[]) => Promise<string> }>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [format, setFormat] = useState<"docx" | "odt" | "pdf">(props.format);
  // Word tracked changes against the opened document, with the signed-in user as their author.
  const [trackChanges, setTrackChanges] = useState(false);
  const [saveAs, setSaveAs] = useState(editedFilename(props.filename));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (root.current) renderBlocks(root.current, props.blocks);
  }, [props.blocks]);

  function run(command: Command): void {
    if (props.readOnly || mode !== "edit") return;
    root.current?.focus();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(command.command, false, command.value);
    setDirty(true);
  }

  async function save(): Promise<void> {
    const target = root.current;
    const name = withExtension(saveAs.trim(), format);
    if (!target || !saveAs.trim()) return;
    setSaving(true);
    setStatus("");
    try {
      await props.onSave(name, format, blocksFromDom(target as unknown as NodeLike), { trackChanges: trackChanges && format === "docx" });
      setDirty(false);
      setStatus(`Zapisano jako „${name}”. Oryginał pozostaje bez zmian.`);
      setSaveAs(editedFilename(name));
    } catch (failure) {
      setStatus(`Nie udało się zapisać: ${failure instanceof Error ? failure.message : String(failure)}`);
    } finally {
      setSaving(false);
    }
  }

  const editing = mode === "edit" && !props.readOnly;

  return (
    <div className="text-editor office-editor">
      <div className="text-editor-toolbar" role="toolbar" aria-label={t("Formatowanie dokumentu")}>
        {editing
          ? COMMANDS.map((command) => (
              <button
                key={command.label}
                type="button"
                title={t(command.title)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(command)}
              >
                {t(command.label)}
              </button>
            ))
          : null}
        <span className="text-editor-spacer" />
        <div className="text-editor-modes" role="group" aria-label={t("Widok")}>
          <button type="button" aria-pressed={mode === "view"} onClick={() => setMode("view")}>{t("Podgląd")}</button>
          {props.readOnly ? null : (
            <button type="button" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>{t("Edycja")}</button>
          )}
        </div>
      </div>
      {editing ? (
        <p className="office-editor-note">
          {t("Zapis tworzy nowy plik w uproszczonym układzie; oryginał pozostaje bez zmian.")}
          <InfoTip>
            {t("Zostają akapity, nagłówki, listy, tabele, pogrubienie, kursywa i podkreślenie. Style, nagłówki i stopki strony, komentarze oraz wcześniejsze śledzone zmiany nie są przenoszone. „Śledź zmiany” (DOCX) zapisuje Twoje poprawki jako śledzone zmiany Worda, z Tobą jako autorem. PDF to wersja do wysłania lub druku.")}
          </InfoTip>
        </p>
      ) : null}
      <div
        ref={root}
        className="office-document"
        contentEditable={editing}
        suppressContentEditableWarning
        spellCheck={editing}
        lang="pl"
        role="textbox"
        aria-multiline="true"
        aria-readonly={!editing}
        aria-label={`Dokument ${props.filename}`}
        onInput={() => setDirty(true)}
        onPaste={(event) => {
          if (!editing) return;
          // Plain text only: pasted HTML could carry styles and scripts.
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          setDirty(true);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            if (editing && dirty) void save();
          }
        }}
      />
      <div className="text-editor-footer">
        <small>{dirty ? "Niezapisane zmiany" : ""}</small>
        {props.readOnly ? (
          <small>{t("Sprawa tylko do odczytu.")}</small>
        ) : (
          <div className="text-editor-save">
            <input
              aria-label={t("Nazwa zapisywanego pliku")}
              value={saveAs}
              onChange={(event) => setSaveAs(event.target.value)}
            />
            <select
              aria-label={t("Format zapisu")}
              value={format}
              onChange={(event) => setFormat(event.target.value as "docx" | "odt" | "pdf")}
            >
              <option value="docx">DOCX</option>
              <option value="odt">ODT</option>
              <option value="pdf">PDF</option>
            </select>
            {format === "docx" ? (
              <label className="text-editor-track" title={t("Zmiany względem otwartego dokumentu zapisane jako śledzone zmiany Worda, z Tobą jako autorem")}>
                <input type="checkbox" checked={trackChanges} onChange={(event) => setTrackChanges(event.target.checked)} />
                {t("Śledź zmiany")}
              </label>
            ) : null}
            <button type="button" disabled={(!dirty && format === props.format) || saving || !saveAs.trim()} onClick={() => void save()}>
              {saving ? "Zapisywanie…" : "Zapisz jako nowy plik"}
            </button>
            {editing
              ? (props.extraActions ?? []).map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    title={action.title ? t(action.title) : undefined}
                    disabled={saving}
                    onClick={() => {
                      const target = root.current;
                      if (!target) return;
                      setSaving(true);
                      setStatus("");
                      void action
                        .run(blocksFromDom(target as unknown as NodeLike))
                        .then((message) => {
                          setDirty(false);
                          setStatus(message);
                        })
                        .catch((failure: unknown) =>
                          setStatus(`Nie udało się: ${failure instanceof Error ? failure.message : String(failure)}`)
                        )
                        .finally(() => setSaving(false));
                    }}
                  >
                    {t(action.label)}
                  </button>
                ))
              : null}
          </div>
        )}
      </div>
      {status ? <p className="text-editor-status" role="status">{status}</p> : null}
    </div>
  );
}
