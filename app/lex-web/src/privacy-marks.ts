import type { PagePrivacyDirective } from "./api.js";

type Range = { page: number; start: number; end: number };

function overlaps(a: Range, b: Range): boolean {
  return a.page === b.page && a.start < b.end && b.start < a.end;
}

/**
 * The user's new mark with the earlier decisions it touches: marks it overlaps are joined
 * into one (the wider range is masked), a "leave in clear" decision under it gives way.
 * The runtime rejects overlapping decisions, so none are sent.
 */
export function addMark(directives: readonly PagePrivacyDirective[], mark: PagePrivacyDirective): PagePrivacyDirective[] {
  let start = mark.start;
  let end = mark.end;
  // Joining can reach further marks ("A" then "C", then "B" spanning both).
  for (let changed = true; changed; ) {
    changed = false;
    for (const other of directives) {
      if (other.action === "KEEP" || !overlaps(other, { page: mark.page, start, end })) continue;
      if (other.start < start || other.end > end) {
        start = Math.min(start, other.start);
        end = Math.max(end, other.end);
        changed = true;
      }
    }
  }
  const joined = { ...mark, start, end };
  return [...directives.filter((other) => !overlaps(other, joined)), joined];
}

/** The automatic proposals not covered by the user's own marks (those are shown instead). */
export function visibleSuggestions<T extends Range>(suggestions: readonly T[], userMarks: readonly Range[]): T[] {
  return suggestions.filter((suggestion) => !userMarks.some((mark) => overlaps(mark, suggestion)));
}
