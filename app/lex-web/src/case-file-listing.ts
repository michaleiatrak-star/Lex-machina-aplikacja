import { CASE_FILE_CATEGORIES, caseFileCategory } from "./case-file-categories.js";

export type CaseFileSort = "kind" | "name" | "newest" | "oldest";

type Listed = { filename: string; mediaType: string; archive: boolean; storedAt: string };

const order = (item: Listed) =>
  CASE_FILE_CATEGORIES.findIndex((entry) => entry.category === caseFileCategory({ kind: "", filename: item.filename, mediaType: item.mediaType, archive: item.archive }));

const folded = (value: string) => value.toLocaleLowerCase("pl").replace(/ł/gu, "l").normalize("NFD").replace(/\p{M}/gu, "");

/**
 * The case files the side panel shows: those whose name holds every word of the search (case and
 * Polish marks ignored), by kind (the case's file types, then name), name, or date added.
 */
export function caseFileListing<T extends Listed>(files: readonly T[], query: string, sort: CaseFileSort): T[] {
  const words = folded(query).split(/\s+/u).filter(Boolean);
  const shown = files.filter((item) => words.every((word) => folded(item.filename).includes(word)));
  const byName = (left: T, right: T) => left.filename.localeCompare(right.filename, "pl", { numeric: true });
  return shown.sort((left, right) =>
    sort === "kind"
      ? order(left) - order(right) || byName(left, right)
      : sort === "name"
        ? byName(left, right)
        : sort === "newest"
          ? right.storedAt.localeCompare(left.storedAt) || byName(left, right)
          : left.storedAt.localeCompare(right.storedAt) || byName(left, right)
  );
}
