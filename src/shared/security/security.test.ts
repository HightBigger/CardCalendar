import { describe, expect, it } from "vitest";
import { applySecurityHeaders } from "./headers";
import { checkSameOriginWrite } from "./origin";
import { InMemoryRateLimiter, rateLimitPolicy } from "./rate-limit";

describe("same-origin write protection", () => {
  const production = { NODE_ENV: "production", APP_URL: "https://cards.example.com" };

  it("allows safe methods and configured same-origin writes", () => {
    expect(checkSameOriginWrite(new Request("https://cards.example.com/api/v1/me"), production)).toEqual({ allowed: true });
    expect(checkSameOriginWrite(new Request("https://internal/api/v1/me", {
      method: "POST",
      headers: { origin: "https://cards.example.com" },
    }), production)).toEqual({ allowed: true });
  });

  it("rejects missing, mismatched, and misconfigured production origins", () => {
    expect(checkSameOriginWrite(new Request("https://cards.example.com/api/v1/me", { method: "POST" }), production)).toMatchObject({ allowed: false, reason: "missing_origin" });
    expect(checkSameOriginWrite(new Request("https://cards.example.com/api/v1/me", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    }), production)).toMatchObject({ allowed: false, reason: "origin_mismatch" });
    expect(checkSameOriginWrite(new Request("https://cards.example.com/api/v1/me", {
      method: "POST",
      headers: { origin: "https://cards.example.com" },
    }), { NODE_ENV: "production" })).toMatchObject({ allowed: false, reason: "invalid_configuration" });
  });

  it("treats local loopback aliases as the same development origin", () => {
    expect(checkSameOriginWrite(new Request("http://localhost:3000/api/v1/auth/register", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000" },
    }), { NODE_ENV: "development" })).toEqual({ allowed: true });

    expect(checkSameOriginWrite(new Request("http://[::1]:3000/api/v1/auth/register", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    }), { NODE_ENV: "development" })).toEqual({ allowed: true });
  });
});

describe("security response headers", () => {
  it("sets browser defenses and only enables HSTS in production", () => {
    const development = new Headers();
    applySecurityHeaders(development, false);
    expect(development.has("content-security-policy")).toBe(false);
    expect(development.get("x-content-type-options")).toBe("nosniff");
    expect(development.has("strict-transport-security")).toBe(false);

    const production = new Headers();
    applySecurityHeaders(production, true);
    expect(production.get("strict-transport-security")).toContain("includeSubDomains");
    expect(production.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("in-memory sensitive endpoint rate limiter", () => {
  it("blocks over-limit requests and resets at the fixed-window boundary", () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter(() => now);
    expect(limiter.consume("login:key", 2, 10).allowed).toBe(true);
    expect(limiter.consume("login:key", 2, 10)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("login:key", 2, 10).allowed).toBe(false);
    now = 11_000;
    expect(limiter.consume("login:key", 2, 10)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("uses bounded defaults for invalid configuration", () => {
    expect(rateLimitPolicy("login", { RATE_LIMIT_LOGIN_MAX: "0", RATE_LIMIT_LOGIN_WINDOW_SECONDS: "999999" })).toEqual({
      limit: 10,
      windowSeconds: 600,
    });
  });
});
