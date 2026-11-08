import type { ProviderAccountSessionStatus, ProviderId } from "./api.js";

/**
 * No model the chat could use: no API key, no signed-in account, no installed local model.
 * Unknown (status not loaded yet) is not "none": the user is sent to the model settings only
 * once every source has answered.
 */
export function noModelAvailable(
  configuration: Record<string, boolean | undefined>,
  accounts: Partial<Record<ProviderId, ProviderAccountSessionStatus | undefined>>,
  localInstalled: boolean | undefined
): boolean {
  const keys = Object.values(configuration);
  if (localInstalled === undefined || keys.some((value) => value === undefined)) return false;
  if (keys.some(Boolean) || localInstalled) return false;
  return !Object.values(accounts).some((account) => account?.authenticated === true);
}
