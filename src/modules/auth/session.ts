import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE = "cardcalendar_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookieValue(token: string, secure: boolean): string {
  const base = SESSION_COOKIE + "=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_MAX_AGE_SECONDS;
  return secure ? base + "; Secure" : base;
}

export function clearSessionCookie(secure: boolean): string {
  const base = SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  return secure ? base + "; Secure" : base;
}
