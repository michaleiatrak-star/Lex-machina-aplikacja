import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalModelRuntime } from "../src/local-model-runtime.js";

const runtime = () => new LocalModelRuntime({ rootDir: path.join(os.tmpdir(), "lex-lock-none"), runtimeRoot: path.join(os.tmpdir(), "lex-lock-rt"), port: 54_332 });
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe("lokalny model: odpowiedź czatu a krok modelu wizyjnego", () => {
  it("krok wizyjny czeka na trwającą odpowiedź; nowa odpowiedź czeka na koniec kroku", async () => {
    const models = runtime();
    const order: string[] = [];
    let endAnswer!: () => void;
    const answer = models.withGeneration(async () => {
      order.push("answer-start");
      await new Promise<void>((resolve) => (endAnswer = resolve));
      order.push("answer-end");
    });
    await tick();
    const vision = models.withExclusiveModel(async () => {
      order.push("vision-start");
      await tick(20);
      order.push("vision-end");
      return "vision";
    }, () => "skipped");
    await tick();
    const second = models.withGeneration(async () => {
      order.push("second");
    });
    await tick();
    expect(order).toEqual(["answer-start"]);
    endAnswer();
    expect(await vision).toBe("vision");
    await answer;
    await second;
    expect(order).toEqual(["answer-start", "answer-end", "vision-start", "vision-end", "second"]);
  });

  it("odpowiedź trwająca dłużej niż limit: krok wizyjny pominięty, bez zakleszczenia", async () => {
    const models = runtime();
    let endAnswer!: () => void;
    const answer = models.withGeneration(() => new Promise<void>((resolve) => (endAnswer = resolve)));
    await tick();
    let ran = false;
    const result = await models.withExclusiveModel(async () => {
      ran = true;
      return "vision";
    }, () => "skipped", 30);
    expect(result).toBe("skipped");
    expect(ran).toBe(false);
    // The lock is free again: another answer starts at once.
    let started = false;
    await models.withGeneration(async () => {
      started = true;
    });
    expect(started).toBe(true);
    endAnswer();
    await answer;
  });
});

describe("lokalny model: zwalnianie pamięci, gdy nie jest używany", () => {
  it("bezczynny dłużej niż próg: zatrzymany; w trakcie odpowiedzi albo kroku wizyjnego: nie", async () => {
    const models = runtime();
    const internal = models as unknown as { child: unknown; lastUsedAt: number; stop: () => Promise<void> };
    let stopped = 0;
    internal.stop = async () => {
      stopped += 1;
      internal.child = null;
    };
    // Not loaded: nothing to release.
    expect(await models.releaseIfIdle(0, "TEST")).toBe(false);
    internal.child = {};
    internal.lastUsedAt = Date.now() - 10 * 60_000;
    let endAnswer!: () => void;
    const answer = models.withGeneration(() => new Promise<void>((resolve) => (endAnswer = resolve)));
    await tick();
    expect(await models.releaseIfIdle(60_000, "OCR")).toBe(false);
    endAnswer();
    await answer;
    // Just answered: the series goes on, the model stays.
    expect(await models.releaseIfIdle(60_000, "OCR")).toBe(false);
    internal.lastUsedAt = Date.now() - 2 * 60_000;
    expect(models.resident).toBe(true);
    expect(await models.releaseIfIdle(60_000, "OCR")).toBe(true);
    expect(stopped).toBe(1);
    expect(models.resident).toBe(false);
  });
});
