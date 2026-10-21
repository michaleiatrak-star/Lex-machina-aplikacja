import type { ProviderCredentialManager, ProviderCredentialResolver } from "../providers/credentials.js";
import type { ProviderId } from "../providers/types.js";

/**
 * Server mode: every account uses the admin's global key of the provider,
 * else the container's environment key; the desktop's process-memory keys do
 * not apply. With the mode off the firm resolver answers as before.
 */
export class ServerModeCredentialResolver implements ProviderCredentialManager {
  constructor(
    private readonly firm: ProviderCredentialManager,
    private readonly environment: ProviderCredentialResolver,
    private readonly serverMode: { isEnabled(): boolean; globalApiKey(provider: ProviderId): string | null }
  ) {}

  async getApiKey(provider: ProviderId): Promise<string | null> {
    if (!this.serverMode.isEnabled()) return await this.firm.getApiKey(provider);
    return this.serverMode.globalApiKey(provider) ?? (await this.environment.getApiKey(provider));
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
