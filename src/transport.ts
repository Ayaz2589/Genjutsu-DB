/**
 * Low-level HTTP transport for Google Sheets v4 REST API.
 * Supports token provider pattern, 401 retry, 403→PERMISSION_ERROR, apiKey for public sheets.
 */

import {
  resolveToken,
  fetchWithErrorHandling,
  buildAuthHeaders,
  appendParams,
  type HttpContext,
} from "./http";
import { apiError } from "./errors";

export const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

export interface TransportContext extends HttpContext {
  spreadsheetId: string;
}

export function extractSpreadsheetId(urlOrId: string): string | null {
  const match = urlOrId.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1]!;
  // If no slashes, treat as a bare ID
  if (!urlOrId.includes("/")) return urlOrId;
  return null;
}

function buildApiKeyParam(ctx: TransportContext): string {
  if (ctx.apiKey && !ctx.auth) {
    return `key=${encodeURIComponent(ctx.apiKey)}`;
  }
  return "";
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
  const valueRanges = data.valueRanges ?? [];
  for (let i = 0; i < ranges.length; i++) {
    const vr = valueRanges[i];
    const values = vr?.values ?? [];
    result.set(ranges[i], values.map((row) => (Array.isArray(row) ? [...row] : [])));
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
