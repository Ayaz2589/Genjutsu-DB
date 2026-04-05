/**
 * Tests for the shared HTTP infrastructure (src/http.ts).
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { GenjutsuError } from "../src/errors";
import {
  resolveToken,
  buildAuthHeaders,
  appendParams,
  parseRetryAfterMs,
  wrapHttpError,
  fetchWithErrorHandling,
  type HttpContext,
} from "../src/http";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(
  body: string,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(body, { status, headers });
}

// ---------------------------------------------------------------------------
// resolveToken
// ---------------------------------------------------------------------------

describe("resolveToken", () => {
  test("returns a static string as-is", async () => {
    const token = await resolveToken("static-token");
    expect(token).toBe("static-token");
  });

  test("calls an async function and returns its result", async () => {
    const token = await resolveToken(async () => "async-token");
    expect(token).toBe("async-token");
  });

  test("calls a sync function and returns its result", async () => {
    const token = await resolveToken(() => Promise.resolve("sync-fn-token"));
    expect(token).toBe("sync-fn-token");
  });
});

// ---------------------------------------------------------------------------
// buildAuthHeaders
// ---------------------------------------------------------------------------

describe("buildAuthHeaders", () => {
  test("returns Authorization header with static token", async () => {
    const headers = await buildAuthHeaders({ auth: "my-token" });
    expect(headers).toEqual({ Authorization: "Bearer my-token" });
  });

  test("returns Authorization header with async token", async () => {
    const headers = await buildAuthHeaders({
      auth: async () => "async-token",
    });
    expect(headers).toEqual({ Authorization: "Bearer async-token" });
  });

  test("returns empty object when no auth provided", async () => {
    const headers = await buildAuthHeaders({});
    expect(headers).toEqual({});
  });

  test("returns empty object when auth is undefined", async () => {
    const headers = await buildAuthHeaders({ auth: undefined });
    expect(headers).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// appendParams
// ---------------------------------------------------------------------------

describe("appendParams", () => {
  test("returns original URL when extra is empty", () => {
    expect(appendParams("https://example.com", "")).toBe("https://example.com");
  });

  test("appends with ? when URL has no query string", () => {
    expect(appendParams("https://example.com", "key=value")).toBe(
      "https://example.com?key=value",
    );
  });

  test("appends with & when URL already has query string", () => {
    expect(appendParams("https://example.com?a=1", "b=2")).toBe(
      "https://example.com?a=1&b=2",
    );
  });
});

// ---------------------------------------------------------------------------
// parseRetryAfterMs
// ---------------------------------------------------------------------------

describe("parseRetryAfterMs", () => {
  test("returns milliseconds from Retry-After header in seconds", () => {
    const res = new Response("", {
      headers: { "Retry-After": "30" },
    });
    expect(parseRetryAfterMs(res)).toBe(30000);
  });

  test("returns undefined when no Retry-After header", () => {
    const res = new Response("");
    expect(parseRetryAfterMs(res)).toBeUndefined();
  });

  test("returns undefined when Retry-After is not a number", () => {
    const res = new Response("", {
      headers: { "Retry-After": "not-a-number" },
    });
    expect(parseRetryAfterMs(res)).toBeUndefined();
  });

  test("handles Retry-After of 0", () => {
    const res = new Response("", {
      headers: { "Retry-After": "0" },
    });
    expect(parseRetryAfterMs(res)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// wrapHttpError
// ---------------------------------------------------------------------------

describe("wrapHttpError", () => {
  test("throws AUTH_ERROR for 401", () => {
    try {
      wrapHttpError(401, "Unauthorized");
      throw new Error("Expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("AUTH_ERROR");
    }
  });

  test("throws PERMISSION_ERROR for 403", () => {
    try {
      wrapHttpError(403, "Forbidden");
      throw new Error("Expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("throws RATE_LIMIT for 429", () => {
    try {
      wrapHttpError(429, "Too Many Requests");
      throw new Error("Expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("RATE_LIMIT");
    }
  });

  test("throws API_ERROR for other status codes", () => {
    try {
      wrapHttpError(500, "Internal Server Error");
      throw new Error("Expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("API_ERROR");
    }
  });

  test("includes cause when provided", () => {
    const cause = new Error("original");
    try {
      wrapHttpError(500, "error", cause);
      throw new Error("Expected error");
    } catch (err) {
      expect((err as GenjutsuError).cause).toBe(cause);
    }
  });
});

// ---------------------------------------------------------------------------
// fetchWithErrorHandling
// ---------------------------------------------------------------------------

describe("fetchWithErrorHandling", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns response on success", async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse({ ok: true })));

    const res = await fetchWithErrorHandling(
      "https://example.com",
      {},
      { auth: "token" },
    );
    expect(res.status).toBe(200);
  });

  test("throws NETWORK_ERROR on fetch failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    try {
      await fetchWithErrorHandling("https://example.com", {}, { auth: "tok" });
      throw new Error("Expected NETWORK_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("NETWORK_ERROR");
    }
  });

  test("throws AUTH_ERROR on 401 with static auth (no retry)", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      return Promise.resolve(textResponse("Unauthorized", 401));
    });

    try {
      await fetchWithErrorHandling(
        "https://example.com",
        {},
        { auth: "static" },
      );
      throw new Error("Expected AUTH_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("AUTH_ERROR");
    }
    expect(callCount).toBe(1);
  });

  test("retries on 401 when auth is a function", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(textResponse("Unauthorized", 401));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    const res = await fetchWithErrorHandling(
      "https://example.com",
      { headers: {} },
      { auth: async () => "fresh-token" },
    );
    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  test("throws PERMISSION_ERROR on 403", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Forbidden", 403)),
    );

    try {
      await fetchWithErrorHandling("https://example.com", {}, { auth: "tok" });
      throw new Error("Expected PERMISSION_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("throws RATE_LIMIT on 429 with retryAfterMs", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        textResponse("Too Many Requests", 429, { "Retry-After": "15" }),
      ),
    );

    try {
      await fetchWithErrorHandling("https://example.com", {}, { auth: "tok" });
      throw new Error("Expected RATE_LIMIT");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      const gErr = err as GenjutsuError;
      expect(gErr.kind).toBe("RATE_LIMIT");
      expect(gErr.retryAfterMs).toBe(15000);
    }
  });

  test("throws API_ERROR on 500", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Internal Server Error", 500)),
    );

    try {
      await fetchWithErrorHandling("https://example.com", {}, { auth: "tok" });
      throw new Error("Expected API_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("API_ERROR");
    }
  });

  test("does not retry when retryOn401 is false", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      return Promise.resolve(textResponse("Unauthorized", 401));
    });

    try {
      await fetchWithErrorHandling(
        "https://example.com",
        {},
        { auth: async () => "token" },
        false,
      );
      throw new Error("Expected AUTH_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("AUTH_ERROR");
    }
    expect(callCount).toBe(1);
  });

  test("throws NETWORK_ERROR when retry fetch fails", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(textResponse("Unauthorized", 401));
      }
      return Promise.reject(new TypeError("Connection reset"));
    });

    try {
      await fetchWithErrorHandling(
        "https://example.com",
        { headers: {} },
        { auth: async () => "token" },
      );
      throw new Error("Expected NETWORK_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("NETWORK_ERROR");
      expect((err as GenjutsuError).message).toContain("retry");
    }
  });
});
