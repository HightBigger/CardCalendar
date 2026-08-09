import { createHash } from "node:crypto";
type Environment = Readonly<Record<string, string | undefined>>;

export type SensitiveEndpoint = "login" | "register" | "export" | "delete";

type PolicyDefaults = {
  limit: number;
  windowSeconds: number;
  limitEnv: string;
  windowEnv: string;
};

export const RATE_LIMIT_DEFAULTS: Readonly<Record<SensitiveEndpoint, PolicyDefaults>> = {
  login: { limit: 10, windowSeconds: 600, limitEnv: "RATE_LIMIT_LOGIN_MAX", windowEnv: "RATE_LIMIT_LOGIN_WINDOW_SECONDS" },
  register: { limit: 5, windowSeconds: 3600, limitEnv: "RATE_LIMIT_REGISTER_MAX", windowEnv: "RATE_LIMIT_REGISTER_WINDOW_SECONDS" },
  export: { limit: 3, windowSeconds: 600, limitEnv: "RATE_LIMIT_EXPORT_MAX", windowEnv: "RATE_LIMIT_EXPORT_WINDOW_SECONDS" },
  delete: { limit: 3, windowSeconds: 3600, limitEnv: "RATE_LIMIT_DELETE_MAX", windowEnv: "RATE_LIMIT_DELETE_WINDOW_SECONDS" },
};

type Entry = { count: number; resetAt: number };
export type RateLimitDecision = { allowed: boolean; limit: number; remaining: number; resetAt: number };

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function rateLimitPolicy(endpoint: SensitiveEndpoint, env: Environment = process.env) {
  const defaults = RATE_LIMIT_DEFAULTS[endpoint];
  return {
    limit: boundedInteger(env[defaults.limitEnv], defaults.limit, 1, 10_000),
    windowSeconds: boundedInteger(env[defaults.windowEnv], defaults.windowSeconds, 1, 86_400),
  };
}

export class InMemoryRateLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  consume(key: string, limit: number, windowSeconds: number): RateLimitDecision {
    const now = this.now();
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowSeconds * 1000 };
    }
    entry.count += 1;
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.prune(now);
    return {
      allowed: entry.count <= limit,
      limit,
      remaining: Math.max(0, limit - entry.count),
      resetAt: entry.resetAt,
    };
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(now: number): void {
    if (this.entries.size <= this.maxKeys) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxKeys) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}

const globalState = globalThis as typeof globalThis & {
  __cardcalendarRateLimiter?: InMemoryRateLimiter;
};

function sharedLimiter(): InMemoryRateLimiter {
  globalState.__cardcalendarRateLimiter ??= new InMemoryRateLimiter();
  return globalState.__cardcalendarRateLimiter;
}

function clientAddress(request: Request, env: Environment): string {
  if (env.RATE_LIMIT_TRUST_PROXY === "true") {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.slice(0, 128);
    const real = request.headers.get("x-real-ip")?.trim();
    if (real) return real.slice(0, 128);
  }
  // Fetch Request does not expose the peer socket. The shared fallback fails closed by
  // limiting the whole untrusted ingress instead of trusting spoofable forwarding headers.
  return "untrusted-ingress";
}

function opaqueKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function limitSensitiveRequest(
  request: Request,
  endpoint: SensitiveEndpoint,
  subject?: string,
  env: Environment = process.env,
): Response | undefined {
  const policy = rateLimitPolicy(endpoint, env);
  const address = clientAddress(request, env);
  const key = `${endpoint}:${opaqueKey(`${address}:${subject ?? "anonymous"}`)}`;
  const decision = sharedLimiter().consume(key, policy.limit, policy.windowSeconds);
  if (decision.allowed) return undefined;

  const retryAfter = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
  return new Response(JSON.stringify({
    error: {
      code: "RATE_LIMITED",
      message: "请求过于频繁，请稍后重试",
      request_id: crypto.randomUUID(),
    },
  }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(retryAfter),
      "x-ratelimit-limit": String(decision.limit),
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.ceil(decision.resetAt / 1000)),
    },
  });
}
