import { describe, expect, it } from "vitest";
import {
  awaitsChoice,
  clearFinished,
  enqueueFiles,
  nextApproved,
  nextToRead,
  queueStatusLabel,
  queueSummary,
  removeQueued,
  stopQueued,
  updateEntry,
  type ProcessingQueueEntry
} from "./processing-queue.js";

const file = (itemId: string, approved = false) => ({ itemId, filename: `${itemId}.pdf`, mode: "ANONYMIZE" as const, approved });

describe("processing queue of a case", () => {
  it("files are read in the order added; a file already waiting keeps its place", () => {
    let queue = enqueueFiles([], [file("a"), file("b")]);
    queue = enqueueFiles(queue, [file("b"), file("c")]);
    expect(queue.map((entry) => entry.itemId)).toEqual(["a", "b", "c"]);
    expect(nextToRead(queue)?.itemId).toBe("a");
    queue = updateEntry(queue, "a", { status: "READING" });
    expect(nextToRead(queue)?.itemId).toBe("b");
  });

  it("files added while one is read join the end of the queue", () => {
    let queue = updateEntry(enqueueFiles([], [file("a"), file("b")]), "a", { status: "READING" });
    queue = enqueueFiles(queue, [file("d")]);
    expect(queue.map((entry) => `${entry.itemId}:${entry.status}`)).toEqual(["a:READING", "b:QUEUED", "d:QUEUED"]);
    expect(queueStatusLabel(queue[2]!, queue)).toBe("w kolejce do OCR (2.)");
  });

  it("a failed file added again is queued again at the end", () => {
    let queue = updateEntry(enqueueFiles([], [file("a"), file("b")]), "a", { status: "FAILED", error: "x" });
    queue = enqueueFiles(queue, [file("a")]);
    expect(queue.map((entry) => `${entry.itemId}:${entry.status}`)).toEqual(["b:QUEUED", "a:QUEUED"]);
    expect(queue[1]!.error).toBeUndefined();
  });

  it("only waiting files can be removed or stopped; the file being read finishes", () => {
    let queue: ProcessingQueueEntry[] = enqueueFiles([], [file("a"), file("b"), file("c")]);
    queue = updateEntry(queue, "a", { status: "READING" });
    expect(removeQueued(queue, "a")).toHaveLength(3);
    expect(removeQueued(queue, "b").map((entry) => entry.itemId)).toEqual(["a", "c"]);
    expect(stopQueued(queue).map((entry) => entry.itemId)).toEqual(["a"]);
  });

  it("read files wait for the user's choice; nothing runs on them before it", () => {
    let queue = enqueueFiles([], [file("a"), file("b"), file("c")]);
    queue = updateEntry(queue, "a", { status: "READ" });
    queue = updateEntry(queue, "b", { status: "FAILED", error: "OCR" });
    queue = updateEntry(queue, "c", { status: "READY" });
    expect(nextApproved(queue)).toBeUndefined();
    expect(awaitsChoice(queue[0]!)).toBe(true);
    expect(queueStatusLabel(queue[0]!, queue)).toContain("wybierz sposób");
    expect(queueSummary(queue)).toEqual({ waiting: 0, running: 0, toChoose: 1, ready: 1, failed: 1, total: 3 });
    expect(clearFinished(queue).map((entry) => entry.itemId)).toEqual(["a"]);
  });

  it("a confirmed file takes the chosen way and goes first: read before the others, then corrected", () => {
    let queue = enqueueFiles([], [file("a"), file("b"), file("c")]);
    queue = updateEntry(queue, "a", { status: "READING" });
    queue = enqueueFiles(queue, [{ ...file("c", true), mode: "OCR_AI" }]);
    expect(queue.find((entry) => entry.itemId === "c")).toMatchObject({ approved: true, mode: "OCR_AI", status: "QUEUED" });
    expect(nextToRead(queue)?.itemId).toBe("c");
    queue = updateEntry(queue, "c", { status: "READ" });
    queue = updateEntry(queue, "a", { status: "READ" });
    expect(nextApproved(queue)?.itemId).toBe("c");
    expect(queueSummary(queue)).toMatchObject({ waiting: 2, toChoose: 1 });
  });

  it("a file already confirmed or being corrected keeps its way", () => {
    let queue = enqueueFiles([], [file("a", true)]);
    queue = updateEntry(queue, "a", { status: "DETECTING" });
    queue = enqueueFiles(queue, [{ ...file("a", true), mode: "OCR" }]);
    expect(queue[0]).toMatchObject({ mode: "ANONYMIZE", status: "DETECTING" });
  });
});
