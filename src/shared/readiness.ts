import { eq, sql } from "drizzle-orm";
import { workerHeartbeats } from "../../db/schema";
import { getDatabase } from "./db/client";

const DEFAULT_MAX_AGE_SECONDS = 90;
type Environment = Readonly<Record<string, string | undefined>>;

export type WorkerState = {
  status: string;
  heartbeatAt: Date;
} | undefined;

type ReadinessDependencies = {
  probeDatabase: () => Promise<void>;
  readWorker: (name: string) => Promise<WorkerState>;
  now: () => Date;
};

export type ReadinessResult = {
  status: "ok" | "not_ready";
  mode: "memory" | "database";
  checks: {
    database: "ok" | "unavailable" | "skipped";
    worker: "ok" | "missing" | "stale" | "stopped" | "unknown" | "skipped";
    heartbeatAt?: string;
    maxAgeSeconds?: number;
  };
};

function maxHeartbeatAge(value: string | undefined): number | undefined {
  if (!value) return DEFAULT_MAX_AGE_SECONDS;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 15 && parsed <= 3600 ? parsed : undefined;
}

function defaultDependencies(): ReadinessDependencies {
  return {
    probeDatabase: async () => {
      await getDatabase().db.execute(sql`select 1`);
    },
    readWorker: async (name) => {
      const rows = await getDatabase().db
        .select({ status: workerHeartbeats.status, heartbeatAt: workerHeartbeats.heartbeatAt })
        .from(workerHeartbeats)
        .where(eq(workerHeartbeats.name, name))
        .limit(1);
      return rows[0];
    },
    now: () => new Date(),
  };
}

export async function checkReadiness(
  env: Environment = process.env,
  dependencies: ReadinessDependencies = defaultDependencies(),
): Promise<ReadinessResult> {
  if (env.USE_DATABASE !== "true") {
    return {
      status: "ok",
      mode: "memory",
      checks: { database: "skipped", worker: "skipped" },
    };
  }

  const maxAgeSeconds = maxHeartbeatAge(env.WORKER_HEARTBEAT_MAX_AGE_SECONDS);
  if (!env.DATABASE_URL || maxAgeSeconds === undefined) {
    return {
      status: "not_ready",
      mode: "database",
      checks: { database: "unavailable", worker: "unknown" },
    };
  }

  try {
    await dependencies.probeDatabase();
  } catch {
    return {
      status: "not_ready",
      mode: "database",
      checks: { database: "unavailable", worker: "unknown" },
    };
  }

  let worker: WorkerState;
  try {
    worker = await dependencies.readWorker(env.WORKER_HEARTBEAT_NAME?.trim() || "primary");
  } catch {
    return {
      status: "not_ready",
      mode: "database",
      checks: { database: "ok", worker: "unknown", maxAgeSeconds },
    };
  }

  if (!worker) {
    return {
      status: "not_ready",
      mode: "database",
      checks: { database: "ok", worker: "missing", maxAgeSeconds },
    };
  }

  const heartbeatAt = worker.heartbeatAt.toISOString();
  if (worker.status !== "running") {
    return {
      status: "not_ready",
      mode: "database",
      checks: { database: "ok", worker: "stopped", heartbeatAt, maxAgeSeconds },
    };
  }

  const ageMs = dependencies.now().getTime() - worker.heartbeatAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeSeconds * 1000) {
    return {
      status: "not_ready",
      mode: "database",
      checks: { database: "ok", worker: "stale", heartbeatAt, maxAgeSeconds },
    };
  }

  return {
    status: "ok",
    mode: "database",
    checks: { database: "ok", worker: "ok", heartbeatAt, maxAgeSeconds },
  };
}
