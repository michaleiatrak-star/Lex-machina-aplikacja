/**
 * Server mode: every account uses the admin's global key of the provider,
 * else the container's environment key; the desktop's process-memory keys do
 * not apply. With the mode off the firm resolver answers as before.
 */
export class ServerModeCredentialResolver {
    firm;
    environment;
    serverMode;
    constructor(firm, environment, serverMode) {
        this.firm = firm;
        this.environment = environment;
        this.serverMode = serverMode;
    }
    async getApiKey(provider) {
        if (!this.serverMode.isEnabled())
            return await this.firm.getApiKey(provider);
        return this.serverMode.globalApiKey(provider) ?? (await this.environment.getApiKey(provider));
    }
    setApiKey(provider, apiKey) {
        this.firm.setApiKey(provider, apiKey);
    }
    clearApiKey(provider) {
        this.firm.clearApiKey(provider);
    }
    hasMemoryKey(provider) {
        return this.firm.hasMemoryKey(provider);
    }
    close() {
        this.firm.close();
    }
}
