import { AsyncLocalStorage } from "node:async_hooks";
import { reportUsage } from "./usage-meter.js";
import { answerLanguageInstruction } from "./answer-language.js";
/**
 * The turn the user stopped ("Zatrzymaj" in the chat): every model call made while the turn runs
 * carries this signal, so the turn ends at the call in progress and makes no further one.
 */
export const executionAbort = new AsyncLocalStorage();
export class ProviderGatewayError extends Error {
    code;
    provider;
    causeValue;
    constructor(code, message, provider, causeValue) {
        super(message);
        this.code = code;
        this.provider = provider;
        this.causeValue = causeValue;
        this.name = "ProviderGatewayError";
    }
}
export class ProviderRegistry {
    providers = new Map();
    register(adapter) {
        if (this.providers.has(adapter.id)) {
            throw new Error(`Provider already registered: ${adapter.id}`);
        }
        this.providers.set(adapter.id, adapter);
    }
    get(id) {
        return this.providers.get(id);
    }
    list() {
        return [...this.providers.values()];
    }
}
export class ProviderGateway {
    registry;
    guard;
    constructor(registry, guard) {
        this.registry = registry;
        this.guard = guard;
    }
    nativeCorpusAccess(providerId, model) {
        return this.registry.get(providerId)?.nativeCorpusAccess?.(model) === true;
    }
    supportsImages(providerId, model) {
        return this.registry.get(providerId)?.supportsImages?.(model) === true;
    }
    async stream(providerId, requested) {
        // The interface language (a request in another language than Polish): appended after the
        // prompt, so a cached prefix stays the same.
        const language = answerLanguageInstruction();
        const params = language
            ? { ...requested, systemPrompt: requested.systemPrompt ? `${requested.systemPrompt}\n\n${language}` : language }
            : { ...requested };
        const stopped = executionAbort.getStore();
        if (stopped?.aborted) {
            throw new ProviderGatewayError("EXECUTION_CANCELLED", "The user stopped the turn.", providerId);
        }
        if (stopped) {
            params.abortSignal = params.abortSignal ? AbortSignal.any([params.abortSignal, stopped]) : stopped;
        }
        const provider = this.registry.get(providerId);
        if (!provider) {
            throw new ProviderGatewayError("UNKNOWN_PROVIDER", `Provider is not registered: ${providerId}`, providerId);
        }
        if (params.tools?.length && !provider.capabilities.tools) {
            throw new ProviderGatewayError("TOOLS_UNSUPPORTED", `Provider ${providerId} does not support tool calling.`, providerId);
        }
        if (params.reasoning &&
            params.reasoning !== "none" &&
            !provider.capabilities.reasoning) {
            throw new ProviderGatewayError("REASONING_UNSUPPORTED", `Provider ${providerId} does not support reasoning controls.`, providerId);
        }
        if (this.guard) {
            try {
                this.guard.beforeCall(providerId, params.model);
            }
            catch (error) {
                throw new ProviderGatewayError("ACCOUNT_POLICY", error instanceof Error ? error.message : String(error), providerId, error);
            }
        }
        try {
            const result = await provider.stream(params);
            reportUsage(result.usage ?? null);
            this.guard?.afterCall(providerId, params.model, result.usage ?? null);
            return result;
        }
        catch (error) {
            if (error instanceof ProviderGatewayError)
                throw error;
            if (stopped?.aborted)
                throw new ProviderGatewayError("EXECUTION_CANCELLED", "The user stopped the turn.", providerId, error);
            throw new ProviderGatewayError("PROVIDER_ERROR", error instanceof Error ? error.message : String(error), providerId, error);
        }
    }
}
