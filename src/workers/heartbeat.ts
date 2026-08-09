import { randomUUID } from "node:crypto";
import { workerHeartbeats } from "../../db/schema";
import type { Database } from "../shared/db/client";
import { getDatabase } from "../shared/db/client";

const DEFAULT_INTERVAL_SECONDS = 30;
type Environment = Readonly<Record<string, string | undefined>>;

function boundedInterval(value: string | undefined): number {
  if (!value) return DEFAULT_INTERVAL_SECONDS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 300) {
    throw new Error("WORKER_HEARTBEAT_INTERVAL_SECONDS must be an integer between 5 and 300");
  }
  return parsed;
}

export type WorkerHeartbeatHandle = { stop: () => Promise<void> };

export async function startWorkerHeartbeat(
  db: Database = getDatabase().db,
  env: Environment = process.env,
): Promise<WorkerHeartbeatHandle> {
  const name = env.WORKER_HEARTBEAT_NAME?.trim() || "primary";
  if (name.length > 100) throw new Error("WORKER_HEARTBEAT_NAME must not exceed 100 characters");

  const intervalSeconds = boundedInterval(env.WORKER_HEARTBEAT_INTERVAL_SECONDS);
  const instanceId = randomUUID();
  const startedAt = new Date();

  const write = async (status: "running" | "stopped") => {
    const now = new Date();
    await db
      .insert(workerHeartbeats)
      .values({ name, instanceId, status, startedAt, heartbeatAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: workerHeartbeats.name,
        set: { instanceId, status, startedAt, heartbeatAt: now, updatedAt: now },
      });
  };

  await write("running");
  let stopped = false;
  let pending = Promise.resolve();
  const enqueue = (status: "running" | "stopped") => {
    // A transient database failure must not prevent later heartbeats from recovering.
    pending = pending.catch(() => undefined).then(() => write(status));
    return pending;
  };
  const timer = setInterval(() => {
    if (stopped) return;
    void enqueue("running").catch((error) => console.error("Worker heartbeat failed", error));
  }, intervalSeconds * 1000);
  timer.unref();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await pending.catch(() => undefined);
      await write("stopped");
    },
  };
}
