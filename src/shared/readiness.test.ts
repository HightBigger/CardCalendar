import { describe, expect, it } from "vitest";
import { checkReadiness, type WorkerState } from "./readiness";

const now = new Date("2026-08-09T12:00:00.000Z");

function dependencies(worker: WorkerState, databaseError = false) {
  return {
    probeDatabase: async () => {
      if (databaseError) throw new Error("offline");
    },
    readWorker: async () => worker,
    now: () => now,
  };
}

describe("readiness", () => {
  it("keeps demo memory mode ready without touching the database", async () => {
    const result = await checkReadiness({ USE_DATABASE: "false" }, dependencies(undefined, true));
    expect(result).toEqual({
      status: "ok",
      mode: "memory",
      checks: { database: "skipped", worker: "skipped" },
    });
  });

  it("requires both database and a fresh running worker in database mode", async () => {
    const env = { USE_DATABASE: "true", DATABASE_URL: "postgres://test" };
    await expect(checkReadiness(env, dependencies({
      status: "running",
      heartbeatAt: new Date(now.getTime() - 30_000),
    }))).resolves.toMatchObject({ status: "ok", checks: { database: "ok", worker: "ok" } });

    await expect(checkReadiness(env, dependencies({
      status: "running",
      heartbeatAt: new Date(now.getTime() - 91_000),
    }))).resolves.toMatchObject({ status: "not_ready", checks: { database: "ok", worker: "stale" } });

    await expect(checkReadiness(env, dependencies(undefined))).resolves.toMatchObject({
      status: "not_ready",
      checks: { database: "ok", worker: "missing" },
    });
  });

  it("fails closed on database and heartbeat configuration errors", async () => {
    await expect(checkReadiness({ USE_DATABASE: "true" }, dependencies(undefined))).resolves.toMatchObject({
      status: "not_ready",
      checks: { database: "unavailable", worker: "unknown" },
    });
    await expect(checkReadiness({
      USE_DATABASE: "true",
      DATABASE_URL: "postgres://test",
      WORKER_HEARTBEAT_MAX_AGE_SECONDS: "2",
    }, dependencies(undefined))).resolves.toMatchObject({ status: "not_ready" });
  });
});
