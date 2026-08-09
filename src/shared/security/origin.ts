const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
type Environment = Readonly<Record<string, string | undefined>>;

export type OriginCheck =
  | { allowed: true }
  | { allowed: false; reason: "missing_origin" | "invalid_configuration" | "origin_mismatch" };

function parseOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.pathname !== "/" || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

function addDevelopmentLoopbackAliases(origins: Set<string>, requestUrl: string): void {
  const requestOrigin = new URL(requestUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(requestOrigin.hostname)) return;

  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    origins.add(`${requestOrigin.protocol}//${host}${requestOrigin.port ? `:${requestOrigin.port}` : ""}`);
  }
}

export function trustedWriteOrigins(
  requestUrl: string,
  env: Environment = process.env,
): Set<string> | undefined {
  const configured = [env.APP_URL, ...(env.CSRF_TRUSTED_ORIGINS ?? "").split(",")]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  const origins = new Set<string>();
  for (const value of configured) {
    const origin = parseOrigin(value);
    if (!origin) return undefined;
    origins.add(origin);
  }

  if (env.NODE_ENV === "production") {
    if (!env.APP_URL || origins.size === 0) return undefined;
    if ([...origins].some((origin) => !origin.startsWith("https://"))) return undefined;
    return origins;
  }

  origins.add(new URL(requestUrl).origin);
  addDevelopmentLoopbackAliases(origins, requestUrl);
  return origins;
}

export function checkSameOriginWrite(
  request: Pick<Request, "method" | "url" | "headers">,
  env: Environment = process.env,
): OriginCheck {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return { allowed: true };

  const origin = parseOrigin(request.headers.get("origin") ?? undefined);
  if (!origin) return { allowed: false, reason: "missing_origin" };

  const trusted = trustedWriteOrigins(request.url, env);
  if (!trusted) return { allowed: false, reason: "invalid_configuration" };
  if (!trusted.has(origin)) return { allowed: false, reason: "origin_mismatch" };
  return { allowed: true };
}
