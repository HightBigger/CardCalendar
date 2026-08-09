import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../shared/db/client";
import { startWorkerHeartbeat } from "./heartbeat";

afterEach(() => vi.useRealTimers());

function heartbeatDatabase(failOnAttempt: number): { db: Database; writes: string[] } {
  const writes: string[] = [];
  let attempt = 0;
  const db = {
    insert: () => ({
      values: (value: { status: string }) => ({
        onConflictDoUpdate: async () => {
          attempt += 1;
          writes.push(value.status);
          if (attempt === failOnAttempt) throw new Error("temporary database failure");
        },
      }),
    }),
  } as unknown as Database;
  return { db, writes };
}

describe("worker heartbeat", () => {
  it("continues writing after a transient heartbeat failure", async () => {
    vi.useFakeTimers();
    const { db, writes } = heartbeatDatabase(2);
    const handle = await startWorkerHeartbeat(db, { WORKER_HEARTBEAT_INTERVAL_SECONDS: "5" });

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(writes).toEqual(["running", "running", "running"]);
    await handle.stop();
    expect(writes.at(-1)).toBe("stopped");
  });
});
