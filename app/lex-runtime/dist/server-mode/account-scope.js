import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage();
export function runInAccountScope(value, work) {
    return scope.run(value, work);
}
export function currentAccountScope() {
    return scope.getStore();
}
