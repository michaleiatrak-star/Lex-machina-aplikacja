import { AsyncLocalStorage } from "node:async_hooks";

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
