/**
 * Shared HTTP infrastructure for Google API transports (Sheets v4, Drive v3).
 * Provides auth resolution, 401 retry, and structured error wrapping.
 */

import {
  authError,
  permissionError,
  rateLimitError,
  networkError,
  apiError,
} from "./errors";

// ---------------------------------------------------------------------------
// Shared Context
// ---------------------------------------------------------------------------

export interface HttpContext {
  auth?: string | (() => Promise<string>);
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Auth Helpers
// ---------------------------------------------------------------------------

export async function resolveToken(
  auth: string | (() => Promise<string>),
): Promise<string> {
  return typeof auth === "function" ? auth() : auth;
}

export async function buildAuthHeaders(
  ctx: HttpContext,
): Promise<Record<string, string>> {
  if (ctx.auth) {
    const token = await resolveToken(ctx.auth);
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

// ---------------------------------------------------------------------------
// URL Helpers
// ---------------------------------------------------------------------------

export function appendParams(url: string, extra: string): string {
  if (!extra) return url;
  return url.includes("?") ? `${url}&${extra}` : `${url}?${extra}`;
}

// ---------------------------------------------------------------------------
// Error Helpers
// ---------------------------------------------------------------------------

export function parseRetryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  return Number.isNaN(seconds) ? undefined : seconds * 1000;
}

export function wrapHttpError(
  status: number,
  body: string,
  cause?: unknown,
): never {
  if (status === 401) {
    throw authError(`Authentication failed: ${status} ${body}`, cause);
  }
  if (status === 403) {
    throw permissionError(`Permission denied: ${status} ${body}`, cause);
  }
  if (status === 429) {
    throw rateLimitError(`Rate limited: ${status} ${body}`, undefined, cause);
  }
  throw apiError(`Sheets API error: ${status} ${body}`, cause);
}

// ---------------------------------------------------------------------------
// Fetch with Error Handling + 401 Retry
// ---------------------------------------------------------------------------

export async function fetchWithErrorHandling(
  url: string,
  init: RequestInit,
  ctx: HttpContext,
  retryOn401 = true,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw networkError(
      `Network request failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  // 401 retry: if auth is a function, call it again for a fresh token and retry once
  if (res.status === 401 && retryOn401 && typeof ctx.auth === "function") {
    const freshToken = await ctx.auth();
    const retryInit = {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        Authorization: `Bearer ${freshToken}`,
      },
    };
    let retryRes: Response;
    try {
      retryRes = await fetch(url, retryInit);
    } catch (err) {
      throw networkError(
        `Network request failed on retry: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    if (!retryRes.ok) {
      const body = await retryRes.text();
      if (retryRes.status === 429) {
        throw rateLimitError(
          `Rate limited: ${retryRes.status} ${body}`,
          parseRetryAfterMs(retryRes),
          retryRes,
        );
      }
      wrapHttpError(retryRes.status, body, retryRes);
    }
    return retryRes;
  }

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) {
      throw rateLimitError(
        `Rate limited: ${res.status} ${body}`,
        parseRetryAfterMs(res),
        res,
      );
    }
    wrapHttpError(res.status, body, res);
  }
  return res;
}
