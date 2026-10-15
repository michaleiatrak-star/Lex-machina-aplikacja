import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OcrLine, OcrPageResult } from "../document-ingestion.js";

// Bytes of page images (base64) kept per document as evidence (masked before
// sending). A byte budget, not a page count: every page of a long scan keeps
// its image while the stored source stays under the store's 256 MB limit.
export const EVIDENCE_MAX_BYTES = 160 * 1024 * 1024;

export type EvidenceBudget = { bytesLeft: number };

export function evidenceBudget(): EvidenceBudget {
  return { bytesLeft: EVIDENCE_MAX_BYTES };
}

type Box = [number, number, number, number];

function box(value: unknown): Box | undefined {
  return Array.isArray(value) && value.length === 4 && value.every((item) => Number.isFinite(item))
    ? (value.map(Number) as Box)
    : undefined;
}

/**
 * Worker output → OcrPageResult: per-line text/score/box and, while the
 * budget lasts (shared across OCR batches of one document), the page image
 * the boxes refer to. A page image comes only with a
 * box for every line (a photo may have no lines); otherwise the page has no image (nothing could be
 * masked reliably).
 */
export async function readOcrPages(
  raw: unknown[],
  evidenceDir: string,
  budget: EvidenceBudget = evidenceBudget()
): Promise<OcrPageResult[]> {
  const pages: OcrPageResult[] = [];
  for (const item of raw) {
    const page = item as OcrPageResult & {
      lines?: Array<{ text?: unknown; score?: unknown; box?: unknown }>;
      evidence?: { file?: unknown; width?: unknown; height?: unknown; unread?: unknown };
    };
    const lines: OcrLine[] | undefined = Array.isArray(page.lines)
      ? page.lines
          .filter((line) => typeof line?.text === "string")
          .map((line) => {
            const lineBox = box(line.box);
            return {
              text: line.text as string,
              ...(typeof line.score === "number" ? { score: line.score } : {}),
              ...(lineBox ? { box: lineBox } : {})
            };
          })
      : undefined;
    const { evidence, ...rest } = page;
    const result: OcrPageResult = { ...rest, ...(lines ? { lines } : {}) };
    delete (result as { image?: unknown }).image;
    const file = typeof evidence?.file === "string" ? path.basename(evidence.file) : null;
    if (
      file &&
      (lines ?? []).every((line) => line.box) &&
      budget.bytesLeft > 0 &&
      Number.isFinite(evidence?.width) &&
      Number.isFinite(evidence?.height)
    ) {
      try {
        const jpeg = (await readFile(path.join(evidenceDir, file))).toString("base64");
        if (jpeg.length > budget.bytesLeft) {
          budget.bytesLeft = 0;
          throw new Error("EVIDENCE_BUDGET_EXCEEDED");
        }
        result.image = {
          jpeg,
          width: Number(evidence!.width),
          height: Number(evidence!.height),
          unread: (Array.isArray(evidence!.unread) ? evidence!.unread : []).map(box).filter((b): b is Box => Boolean(b))
        };
        budget.bytesLeft -= jpeg.length;
      } catch {
        // No image for this page: text only.
      }
    }
    pages.push(result);
  }
  return pages;
}
