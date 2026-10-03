import { AsyncLocalStorage } from "node:async_hooks";

/** Tokens of all model calls made within one metered turn. */
export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  modelCalls: number;
  // Calls whose adapter does not report tokens (account CLI clients).
  unmeteredCalls: number;
};

const scope = new AsyncLocalStorage<ModelUsage>();

export async function meterUsage<T>(work: () => Promise<T>): Promise<{ result: T; usage: ModelUsage }> {
  const usage: ModelUsage = { inputTokens: 0, outputTokens: 0, modelCalls: 0, unmeteredCalls: 0 };
  const result = await scope.run(usage, work);
  return { result, usage };
}

export function reportUsage(tokens: { inputTokens?: number | undefined; outputTokens?: number | undefined } | null): void {
  const usage = scope.getStore();
  if (!usage) return;
  usage.modelCalls += 1;
  if (!tokens || (tokens.inputTokens === undefined && tokens.outputTokens === undefined)) {
    usage.unmeteredCalls += 1;
    return;
  }
  usage.inputTokens += tokens.inputTokens ?? 0;
  usage.outputTokens += tokens.outputTokens ?? 0;
}
