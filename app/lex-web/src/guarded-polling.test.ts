import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startGuardedPolling } from "./guarded-polling.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startGuardedPolling", () => {
  it("nie wysyła kolejnego zapytania, póki poprzednie trwa", async () => {
    let resolve: (value: number) => void = () => {};
    const fetchOnce = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
    const onData = vi.fn();
    const stop = startGuardedPolling(fetchOnce, onData, 750);

    await vi.advanceTimersByTimeAsync(750 * 4);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    resolve(1);
    await vi.advanceTimersByTimeAsync(750);
    expect(onData).toHaveBeenCalledWith(1);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
    stop();
  });

  it("spóźniona odpowiedź po stop() nie nadpisuje stanu", async () => {
    let resolve: (value: string) => void = () => {};
    const fetchOnce = vi.fn(() => new Promise<string>((done) => { resolve = done; }));
    const onData = vi.fn();
    const stop = startGuardedPolling(fetchOnce, onData, 750);

    await vi.advanceTimersByTimeAsync(750);
    stop();
    resolve("provisioning: true");
    await vi.advanceTimersByTimeAsync(750 * 3);
    expect(onData).not.toHaveBeenCalled();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });
});
