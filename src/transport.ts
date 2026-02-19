/**
 * Low-level HTTP transport for Google Sheets v4 REST API.
 * Supports token provider pattern, 401 retry, 403→PERMISSION_ERROR, apiKey for public sheets.
 */

import {
  authError,
  permissionError,
  rateLimitError,
  networkError,
  apiError,
} from "./errors";

export const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export interface TransportContext {
  auth?: string | (() => Promise<string>);
  apiKey?: string;
  spreadsheetId: string;
}

async function resolveToken(auth: string | (() => Promise<string>)): Promise<string> {
  return typeof auth === "function" ? auth() : auth;
}

export function extractSpreadsheetId(urlOrId: string): string | null {
  const match = urlOrId.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1]!;
  // If no slashes, treat as a bare ID
  if (!urlOrId.includes("/")) return urlOrId;
  return null;
}

function parseRetryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("Retry-After");
  if (!header) return undefined;
  const seconds = parseInt(header, 10);
  return Number.isNaN(seconds) ? undefined : seconds * 1000;
}

function wrapHttpError(status: number, body: string, cause?: unknown): never {
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

async function buildAuthHeaders(ctx: TransportContext): Promise<Record<string, string>> {
  if (ctx.auth) {
    const token = await resolveToken(ctx.auth);
    return { Authorization: `Bearer ${token}` };
  }
  return {};
}

function buildApiKeyParam(ctx: TransportContext): string {
  if (ctx.apiKey && !ctx.auth) {
    return `key=${encodeURIComponent(ctx.apiKey)}`;
  }
  return "";
}

function appendParams(url: string, extra: string): string {
  if (!extra) return url;
  return url.includes("?") ? `${url}&${extra}` : `${url}?${extra}`;
}

async function fetchWithErrorHandling(
  url: string,
  init: RequestInit,
  ctx: TransportContext,
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

// ---------------------------------------------------------------------------
// Read Operations
// ---------------------------------------------------------------------------

export async function getSheetValues(
  ctx: TransportContext,
  range: string,
  valueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" = "FORMATTED_VALUE",
): Promise<unknown[][]> {
  const params = new URLSearchParams({ valueRenderOption });
  let url = `${SHEETS_API}/${ctx.spreadsheetId}/values/${encodeURIComponent(range)}?${params}`;
  url = appendParams(url, buildApiKeyParam(ctx));
  const headers = await buildAuthHeaders(ctx);
  const res = await fetchWithErrorHandling(url, { headers }, ctx);
  const data = (await res.json()) as { values?: unknown[][] };
  const values = data.values;
  if (!Array.isArray(values) || values.length === 0) return [];
  return values.map((row) => (Array.isArray(row) ? [...row] : []));
}

export async function batchGetValues(
  ctx: TransportContext,
  ranges: string[],
  valueRenderOption: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" = "FORMATTED_VALUE",
): Promise<Map<string, unknown[][]>> {
  if (ranges.length === 0) return new Map();
  const params = new URLSearchParams({ valueRenderOption });
  for (const r of ranges) params.append("ranges", r);
  let url = `${SHEETS_API}/${ctx.spreadsheetId}/values:batchGet?${params}`;
  url = appendParams(url, buildApiKeyParam(ctx));
  const headers = await buildAuthHeaders(ctx);
  const res = await fetchWithErrorHandling(url, { headers }, ctx);
  const data = (await res.json()) as {
    valueRanges?: { range: string; values?: unknown[][] }[];
  };
  const result = new Map<string, unknown[][]>();
  for (const vr of data.valueRanges ?? []) {
    const values = vr.values ?? [];
    result.set(vr.range, values.map((row) => (Array.isArray(row) ? [...row] : [])));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Write Operations
// ---------------------------------------------------------------------------

export async function updateSheet(
  ctx: TransportContext,
  range: string,
  values: unknown[][],
  append: boolean,
): Promise<void> {
  const url = append
    ? `${SHEETS_API}/${ctx.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`
    : `${SHEETS_API}/${ctx.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const method = append ? "POST" : "PUT";
  const headers: Record<string, string> = {
    ...(await buildAuthHeaders(ctx)),
    "Content-Type": "application/json",
  };
  await fetchWithErrorHandling(url, { method, headers, body: JSON.stringify({ values }) }, ctx);
}

export async function clearRange(
  ctx: TransportContext,
  range: string,
): Promise<void> {
  const url = `${SHEETS_API}/${ctx.spreadsheetId}/values/${encodeURIComponent(range)}:clear`;
  const headers: Record<string, string> = {
    ...(await buildAuthHeaders(ctx)),
    "Content-Type": "application/json",
  };
  await fetchWithErrorHandling(url, { method: "POST", headers, body: JSON.stringify({}) }, ctx);
}

// ---------------------------------------------------------------------------
// Batch Operations
// ---------------------------------------------------------------------------

export async function batchClear(
  ctx: TransportContext,
  ranges: string[],
): Promise<void> {
  const url = `${SHEETS_API}/${ctx.spreadsheetId}/values:batchClear`;
  const headers: Record<string, string> = {
    ...(await buildAuthHeaders(ctx)),
    "Content-Type": "application/json",
  };
  const res = await fetchWithErrorHandling(
    url,
    { method: "POST", headers, body: JSON.stringify({ ranges }) },
    ctx,
  );
  // Response consumed by fetchWithErrorHandling
  void res;
}

export async function batchUpdate(
  ctx: TransportContext,
  data: { range: string; values: unknown[][] }[],
): Promise<void> {
  const url = `${SHEETS_API}/${ctx.spreadsheetId}/values:batchUpdate`;
  const headers: Record<string, string> = {
    ...(await buildAuthHeaders(ctx)),
    "Content-Type": "application/json",
  };
  const res = await fetchWithErrorHandling(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ data, valueInputOption: "USER_ENTERED" }),
    },
    ctx,
  );
  void res;
}

// ---------------------------------------------------------------------------
// Spreadsheet Metadata
// ---------------------------------------------------------------------------

export async function getSpreadsheetMetadata(
  ctx: TransportContext,
): Promise<{ sheets: { sheetId: number; title: string }[] }> {
  let url = `${SHEETS_API}/${ctx.spreadsheetId}?fields=sheets.properties(sheetId,title)`;
  url = appendParams(url, buildApiKeyParam(ctx));
  const headers = await buildAuthHeaders(ctx);
  const res = await fetchWithErrorHandling(url, { headers }, ctx);
  const data = (await res.json()) as {
    sheets?: { properties: { sheetId: number; title: string } }[];
  };
  return {
    sheets: (data.sheets ?? []).map((s) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
    })),
  };
}

// ---------------------------------------------------------------------------
// Structural Operations (for migrations)
// ---------------------------------------------------------------------------

export async function structuralBatchUpdate(
  ctx: TransportContext,
  requests: Record<string, unknown>[],
): Promise<void> {
  const url = `${SHEETS_API}/${ctx.spreadsheetId}:batchUpdate`;
  const headers: Record<string, string> = {
    ...(await buildAuthHeaders(ctx)),
    "Content-Type": "application/json",
  };
  await fetchWithErrorHandling(
    url,
    { method: "POST", headers, body: JSON.stringify({ requests }) },
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Spreadsheet Creation
// ---------------------------------------------------------------------------

export async function createSpreadsheet(
  title: string,
  auth: string | (() => Promise<string>),
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const token = await resolveToken(auth);
  const res = await fetch(SHEETS_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: { title } }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw apiError(`Failed to create spreadsheet: ${res.status} ${body}`);
  }
  const data = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
  };
  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl,
  };
}
