const COMMON_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

export const PRODUCTION_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "upgrade-insecure-requests",
  ].join("; "),
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
};

export function applySecurityHeaders(headers: Headers, production: boolean): void {
  for (const [name, value] of Object.entries(COMMON_SECURITY_HEADERS)) headers.set(name, value);
  if (production) {
    for (const [name, value] of Object.entries(PRODUCTION_SECURITY_HEADERS)) headers.set(name, value);
  }
}
