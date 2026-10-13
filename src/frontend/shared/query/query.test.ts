import { describe, expect, it } from "vitest";
import { RequestSequence } from "./request-sequence";
import { IntentKeys } from "./intent";
import { invalidate, subscribeInvalidation } from "./invalidation";
describe("feature request ownership", () => {
  it("aborts old requests and rejects their late responses after query or session changes", () => {
    const sequence = new RequestSequence(); const old = sequence.begin(); const current = sequence.begin();
    expect(old.signal.aborted).toBe(true); expect(old.current()).toBe(false); expect(current.current()).toBe(true);
    sequence.cancel(); expect(current.current()).toBe(false);
  });
  it("retains an intent key on failure and changes it for edited parameters, success or a new session", () => {
    const keys = new IntentKeys(); const draft = { title: "核对", expectedVersion: 1 }; const key = keys.key("todo/1", draft);
    expect(keys.key("todo/1", draft)).toBe(key); expect(keys.key("todo/1", { ...draft, expectedVersion: 2 })).not.toBe(key);
    keys.committed("todo/1", draft); expect(keys.key("todo/1", draft)).not.toBe(key);
    const pending = keys.key("todo/1", draft); keys.clear(); expect(keys.key("todo/1", draft)).not.toBe(pending);
  });
  it("sends invalidation signals only, with session identity and resource boundaries", () => {
    const events: unknown[] = []; const unsubscribe = subscribeInvalidation((event) => events.push(event));
    invalidate("account-a", ["todos", "notifications"]); unsubscribe(); invalidate("account-b", ["rewards"]);
    expect(events).toEqual([{ scope: "account-a", resources: ["todos", "notifications"] }]);
  });
});
