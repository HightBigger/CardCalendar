import type { Resource } from "../../../contracts/workbench";
type Invalidation = { scope: string; resources: readonly Resource[] };
const listeners = new Set<(event: Invalidation) => void>();
export function invalidate(scope: string, resources: readonly Resource[]) {
  listeners.forEach((listener) => listener({ scope, resources }));
}
export function subscribeInvalidation(listener: (event: Invalidation) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
