import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage();
export async function meterUsage(work) {
    const usage = { inputTokens: 0, outputTokens: 0, modelCalls: 0, unmeteredCalls: 0 };
    const result = await scope.run(usage, work);
    return { result, usage };
}
export function reportUsage(tokens) {
    const usage = scope.getStore();
    if (!usage)
        return;
    usage.modelCalls += 1;
    if (!tokens || (tokens.inputTokens === undefined && tokens.outputTokens === undefined)) {
        usage.unmeteredCalls += 1;
        return;
    }
    usage.inputTokens += tokens.inputTokens ?? 0;
    usage.outputTokens += tokens.outputTokens ?? 0;
}
