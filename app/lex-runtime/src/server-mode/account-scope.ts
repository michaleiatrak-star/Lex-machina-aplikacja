import { AsyncLocalStorage } from "node:async_hooks";
import type { ProviderCredentialManager } from "../providers/credentials.js";
import type { ProviderId } from "../providers/types.js";

/** The account a request runs for (server mode only; absent on the desktop). */
export type AccountScope = {
  userId: string;
  sessionId: string;
  turnId?: string;
};

const scope = new AsyncLocalStorage<AccountScope>();

export function runInAccountScope<T>(value: AccountScope, work: () => T): T {
  return scope.run(value, work);
}

export function currentAccountScope(): AccountScope | undefined {
  return scope.getStore();
}

/**
 * The account's own API key (BYOK) before the firm's key. Outside an account
 * scope, or without a BYOK key, the firm's resolver answers as before.
 */
export class AccountScopedCredentialResolver implements ProviderCredentialManager {
  constructor(
    private readonly firm: ProviderCredentialManager,
    private readonly accountKey: (scope: AccountScope, provider: ProviderId) => Promise<string | null>
  ) {}

  async getApiKey(provider: ProviderId): Promise<string | null> {
    const account = currentAccountScope();
    if (account) {
      const own = await this.accountKey(account, provider);
      if (own) return own;
    }
    return await this.firm.getApiKey(provider);
  }

  setApiKey(provider: ProviderId, apiKey: string): void {
    this.firm.setApiKey(provider, apiKey);
  }

  clearApiKey(provider: ProviderId): void {
    this.firm.clearApiKey(provider);
  }

  hasMemoryKey(provider: ProviderId): boolean {
    return this.firm.hasMemoryKey(provider);
  }

  close(): void {
    this.firm.close();
  }
}
