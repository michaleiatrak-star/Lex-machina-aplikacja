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
      lines?: Array<{ text?: unknown; score?: unknown; box?: unknown; crop?: unknown; stamp?: unknown }>;
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
              ...(lineBox ? { box: lineBox } : {}),
              ...(typeof line.crop === "string" && line.crop ? { crop: line.crop } : {}),
              ...(line.stamp === true ? { stamp: true } : {})
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

/**
 * The error of a failed PaddleOCR worker. Models left incomplete by an installation cut
 * short get their own code (the UI asks to finish the installation); a missing Python
 * package is OCR_ENGINE_MISSING; anything else OCR_ENGINE_FAILED with the worker's stderr.
 */
export function ocrWorkerFailure(stderr: string, code: number | null, worker: string): Error {
  const incomplete = /LEX_OCR_MODELS_INCOMPLETE:([\w.,-]+)/u.exec(stderr);
  if (incomplete) return new Error(`OCR_MODELS_INCOMPLETE: ${incomplete[1]!.split(",").join(", ")}`);
  const kind = /ModuleNotFoundError|No module named/.test(stderr) ? "OCR_ENGINE_MISSING" : "OCR_ENGINE_FAILED";
  return new Error(`${kind}: Local PaddleOCR ${worker} failed with exit code ${code}: ${stderr.trim()}`);
}
