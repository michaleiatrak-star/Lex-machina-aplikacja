// Files of a case grouped by kind, so one choice (e.g. the processing mode) can be applied
// to all files of the same kind at once.

export type CaseFileCategory =
  | "PDF"
  | "OFFICE"
  | "IMAGE"
  | "RECORDING"
  | "EMAIL"
  | "SHEET"
  | "TEXT"
  | "ARCHIVE"
  | "TEMPLATE"
  | "OTHER";

export const CASE_FILE_CATEGORIES: ReadonlyArray<{ category: CaseFileCategory; label: string }> = [
  { category: "PDF", label: "Dokumenty PDF" },
  { category: "OFFICE", label: "Dokumenty Word, ODT, RTF" },
  { category: "IMAGE", label: "Skany i zdjęcia" },
  { category: "RECORDING", label: "Nagrania (audio, wideo)" },
  { category: "EMAIL", label: "Wiadomości e-mail" },
  { category: "SHEET", label: "Arkusze i tabele" },
  { category: "TEXT", label: "Pliki tekstowe" },
  { category: "ARCHIVE", label: "Archiwa ZIP" },
  { category: "TEMPLATE", label: "Wzory" },
  { category: "OTHER", label: "Inne" }
];

const RECORDING_EXT = /\.(?:mp3|wav|m4a|aac|ogg|oga|opus|flac|weba|webm|mp4|m4v|mov|mkv|avi)$/iu;

export function caseFileCategory(item: { kind: string; filename: string; mediaType: string; archive: boolean }): CaseFileCategory {
  if (item.kind === "TEMPLATE") return "TEMPLATE";
  const type = item.mediaType.split(";")[0]!.trim().toLowerCase();
  const name = item.filename.toLowerCase();
  if (item.archive || type === "application/zip" || name.endsWith(".zip")) return "ARCHIVE";
  if (type.startsWith("audio/") || type.startsWith("video/") || RECORDING_EXT.test(name)) return "RECORDING";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "PDF";
  if (type.startsWith("image/")) return "IMAGE";
  if (type === "message/rfc822" || name.endsWith(".eml")) return "EMAIL";
  if (
    type.includes("spreadsheet") ||
    type.includes("ms-excel") ||
    type === "text/csv" ||
    type === "text/tab-separated-values" ||
    /\.(?:xlsx|xlsm|xls|csv|tsv|ods)$/u.test(name)
  ) {
    return "SHEET";
  }
  if (
    type.includes("wordprocessing") ||
    type.includes("opendocument") ||
    type.includes("msword") ||
    type === "application/rtf" ||
    type === "text/rtf" ||
    /\.(?:docx|doc|odt|rtf)$/u.test(name)
  ) {
    return "OFFICE";
  }
  if (type.startsWith("text/") || type === "application/json" || type === "application/xml") return "TEXT";
  return "OTHER";
}

export function caseFileCategoryLabel(category: CaseFileCategory): string {
  return CASE_FILE_CATEGORIES.find((entry) => entry.category === category)?.label ?? "Inne";
}

/** The items in category order (as CASE_FILE_CATEGORIES), empty categories left out. */
export function groupCaseFiles<T extends { kind: string; filename: string; mediaType: string; archive: boolean }>(
  items: ReadonlyArray<T>
): Array<{ category: CaseFileCategory; label: string; items: T[] }> {
  const groups = new Map<CaseFileCategory, T[]>();
  for (const item of items) {
    const category = caseFileCategory(item);
    groups.set(category, [...(groups.get(category) ?? []), item]);
  }
  return CASE_FILE_CATEGORIES.filter((entry) => groups.has(entry.category)).map((entry) => ({
    ...entry,
    items: groups.get(entry.category)!
  }));
}
