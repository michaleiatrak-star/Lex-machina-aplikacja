import { describe, expect, it } from "vitest";
import {
  clearFinished,
  enqueueFiles,
  nextToRead,
  queueStatusLabel,
  queueSummary,
  readEntries,
  removeQueued,
  stopQueued,
  updateEntry,
  type ProcessingQueueEntry
} from "./processing-queue.js";

const file = (itemId: string) => ({ itemId, filename: `${itemId}.pdf`, mode: "ANONYMIZE" as const });

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

  it("read files wait for the personal data step; summary and clearing", () => {
    let queue = enqueueFiles([], [file("a"), file("b"), file("c")]);
    queue = updateEntry(queue, "a", { status: "READ" });
    queue = updateEntry(queue, "b", { status: "FAILED", error: "OCR" });
    queue = updateEntry(queue, "c", { status: "READY" });
    expect(readEntries(queue).map((entry) => entry.itemId)).toEqual(["a"]);
    expect(queueSummary(queue)).toEqual({ waiting: 1, running: 0, ready: 1, failed: 1, total: 3 });
    expect(clearFinished(queue).map((entry) => entry.itemId)).toEqual(["a"]);
  });
});
