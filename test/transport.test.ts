/**
 * Tests for the low-level HTTP transport module (src/transport.ts).
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { GenjutsuError } from "../src/errors";
import {
  extractSpreadsheetId,
  getSheetValues,
  batchGetValues,
  updateSheet,
  clearRange,
  createSpreadsheet,
  SHEETS_API,
  type TransportContext,
} from "../src/transport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

/** Build a minimal TransportContext with auth token. */
function ctx(overrides: Partial<TransportContext> = {}): TransportContext {
  return {
    spreadsheetId: "test-sheet-id",
    auth: "static-token",
    ...overrides,
  };
}

/** Create a mock Response with JSON body. */
function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Create a text Response (for error bodies). */
function textResponse(body: string, status: number, headers?: Record<string, string>): Response {
  return new Response(body, { status, headers });
}

// ---------------------------------------------------------------------------
// extractSpreadsheetId
// ---------------------------------------------------------------------------

describe("extractSpreadsheetId", () => {
  test("extracts ID from a full Google Sheets URL", () => {
    const url =
      "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit#gid=0";
    expect(extractSpreadsheetId(url)).toBe("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms");
  });

  test("extracts ID from a URL without trailing path", () => {
    const url =
      "https://docs.google.com/spreadsheets/d/abc123-_xyz";
    expect(extractSpreadsheetId(url)).toBe("abc123-_xyz");
  });

  test("returns bare ID when input has no slashes", () => {
    expect(extractSpreadsheetId("abc123XYZ")).toBe("abc123XYZ");
  });

  test("returns null for unrecognized URL format (has slashes but no /d/ segment)", () => {
    expect(extractSpreadsheetId("https://example.com/sheets/abc123")).toBeNull();
  });

  test("returns null for a URL with slashes but missing /d/ pattern", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getSheetValues
// ---------------------------------------------------------------------------

describe("getSheetValues", () => {
  beforeEach(() => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse({ values: [["a", "b"], ["c", "d"]] })),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns parsed values from a successful response", async () => {
    const result = await getSheetValues(ctx(), "Sheet1!A1:B2");
    expect(result).toEqual([["a", "b"], ["c", "d"]]);
  });

  test("returns empty array when response has no values key", async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse({})));
    const result = await getSheetValues(ctx(), "Sheet1!A1:B2");
    expect(result).toEqual([]);
  });

  test("returns empty array when values is an empty array", async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse({ values: [] })));
    const result = await getSheetValues(ctx(), "Sheet1!A1:B2");
    expect(result).toEqual([]);
  });

  test("passes correct Authorization header with a static token", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ values: [] })),
    );
    globalThis.fetch = mockFetch;

    await getSheetValues(ctx({ auth: "my-static-token" }), "Sheet1!A1:B2");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-static-token");
  });

  test("passes correct Authorization header with an async token provider", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ values: [] })),
    );
    globalThis.fetch = mockFetch;

    const tokenProvider = async () => "async-token-value";
    await getSheetValues(ctx({ auth: tokenProvider }), "Sheet1!A1:B2");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer async-token-value");
  });

  test("appends apiKey query param when no auth is provided", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ values: [] })),
    );
    globalThis.fetch = mockFetch;

    await getSheetValues(
      ctx({ auth: undefined, apiKey: "my-api-key" }),
      "Sheet1!A1:B2",
    );

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("key=my-api-key");
  });

  test("does NOT append apiKey when auth is present", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ values: [] })),
    );
    globalThis.fetch = mockFetch;

    await getSheetValues(
      ctx({ auth: "some-token", apiKey: "my-api-key" }),
      "Sheet1!A1:B2",
    );

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("key=my-api-key");
  });

  test("throws AUTH_ERROR on 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Unauthorized", 401)),
    );

    try {
      await getSheetValues(ctx(), "Sheet1!A1:B2");
      throw new Error("Expected AUTH_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("AUTH_ERROR");
    }
  });

  test("throws RATE_LIMIT on 429", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Too Many Requests", 429)),
    );

    try {
      await getSheetValues(ctx(), "Sheet1!A1:B2");
      throw new Error("Expected RATE_LIMIT to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("RATE_LIMIT");
    }
  });

  test("throws NETWORK_ERROR on fetch failure", async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    try {
      await getSheetValues(ctx(), "Sheet1!A1:B2");
      throw new Error("Expected NETWORK_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("NETWORK_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// 401 retry logic
// ---------------------------------------------------------------------------

describe("401 retry logic", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("retries with fresh token when auth is an async function and first request returns 401", async () => {
    let callCount = 0;
    const mockFetch = mock((_url: string, init: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        // First call returns 401
        return Promise.resolve(textResponse("Unauthorized", 401));
      }
      // Second call succeeds
      return Promise.resolve(jsonResponse({ values: [["retried"]] }));
    });
    globalThis.fetch = mockFetch;

    let tokenCallCount = 0;
    const tokenProvider = async () => {
      tokenCallCount++;
      return tokenCallCount === 1 ? "stale-token" : "fresh-token";
    };

    const result = await getSheetValues(ctx({ auth: tokenProvider }), "Sheet1!A1:A1");

    expect(result).toEqual([["retried"]]);
    expect(callCount).toBe(2);
    // Token provider called once during buildAuthHeaders, once during retry
    expect(tokenCallCount).toBe(2);

    // Verify the retry used the fresh token
    const [, retryInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer fresh-token");
  });

  test("does NOT retry when auth is a static string and first request returns 401", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      return Promise.resolve(textResponse("Unauthorized", 401));
    });

    try {
      await getSheetValues(ctx({ auth: "static-token" }), "Sheet1!A1:A1");
      throw new Error("Expected AUTH_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("AUTH_ERROR");
    }

    // Only one fetch call, no retry
    expect(callCount).toBe(1);
  });

  test("throws AUTH_ERROR when retry also returns 401", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Unauthorized", 401)),
    );

    const tokenProvider = async () => "always-bad-token";

    try {
      await getSheetValues(ctx({ auth: tokenProvider }), "Sheet1!A1:A1");
      throw new Error("Expected AUTH_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("AUTH_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// 403 handling
// ---------------------------------------------------------------------------

describe("403 handling", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("throws PERMISSION_ERROR on 403", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Forbidden", 403)),
    );

    try {
      await getSheetValues(ctx(), "Sheet1!A1:A1");
      throw new Error("Expected PERMISSION_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("throws PERMISSION_ERROR on 403 even with async auth (no retry for 403)", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      return Promise.resolve(textResponse("Forbidden", 403));
    });

    const tokenProvider = async () => "some-token";

    try {
      await getSheetValues(ctx({ auth: tokenProvider }), "Sheet1!A1:A1");
      throw new Error("Expected PERMISSION_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }

    // Only one call -- 403 is not retried
    expect(callCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// createSpreadsheet
// ---------------------------------------------------------------------------

describe("createSpreadsheet", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("POSTs to the correct URL with title in request body", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(
        jsonResponse({
          spreadsheetId: "new-id-123",
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/new-id-123/edit",
        }),
      ),
    );
    globalThis.fetch = mockFetch;

    const result = await createSpreadsheet("My Sheet", "my-token");

    // Verify URL
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(SHEETS_API);
    expect(init.method).toBe("POST");

    // Verify body contains title
    const body = JSON.parse(init.body as string);
    expect(body.properties.title).toBe("My Sheet");

    // Verify auth header
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-token");

    // Verify return value
    expect(result.spreadsheetId).toBe("new-id-123");
    expect(result.spreadsheetUrl).toBe(
      "https://docs.google.com/spreadsheets/d/new-id-123/edit",
    );
  });

  test("returns spreadsheetId and spreadsheetUrl from the response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({
          spreadsheetId: "abc-xyz",
          spreadsheetUrl: "https://docs.google.com/spreadsheets/d/abc-xyz/edit",
        }),
      ),
    );

    const result = await createSpreadsheet("Budget", async () => "async-tok");
    expect(result).toEqual({
      spreadsheetId: "abc-xyz",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/abc-xyz/edit",
    });
  });

  test("throws API_ERROR when the creation request fails", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Internal Server Error", 500)),
    );

    try {
      await createSpreadsheet("Broken", "tok");
      throw new Error("Expected API_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("API_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// batchGetValues
// ---------------------------------------------------------------------------

describe("batchGetValues", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns a map of range to values", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({
          valueRanges: [
            { range: "Sheet1!A1:B2", values: [["a", "b"], ["c", "d"]] },
            { range: "Sheet2!A1:A3", values: [["x"], ["y"], ["z"]] },
          ],
        }),
      ),
    );

    const result = await batchGetValues(ctx(), ["Sheet1!A1:B2", "Sheet2!A1:A3"]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get("Sheet1!A1:B2")).toEqual([["a", "b"], ["c", "d"]]);
    expect(result.get("Sheet2!A1:A3")).toEqual([["x"], ["y"], ["z"]]);
  });

  test("returns empty map for empty ranges array (no fetch call)", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({})),
    );
    globalThis.fetch = mockFetch;

    const result = await batchGetValues(ctx(), []);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
    // Should not have made any fetch calls
    expect(mockFetch.mock.calls.length).toBe(0);
  });

  test("handles response with missing valueRanges gracefully", async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse({})));

    const result = await batchGetValues(ctx(), ["Sheet1!A1:A1"]);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  test("appends all ranges as query params", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ valueRanges: [] })),
    );
    globalThis.fetch = mockFetch;

    await batchGetValues(ctx(), ["Sheet1!A1:A1", "Sheet2!B1:B5"]);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("ranges=Sheet1");
    expect(url).toContain("ranges=Sheet2");
  });
});

// ---------------------------------------------------------------------------
// updateSheet
// ---------------------------------------------------------------------------

describe("updateSheet", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends PUT for non-append mode", async () => {
    const mockFetch = mock(() => Promise.resolve(jsonResponse({})));
    globalThis.fetch = mockFetch;

    await updateSheet(ctx(), "Sheet1!A1:B2", [["a", "b"]], false);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(url).toContain(`${SHEETS_API}/test-sheet-id/values/`);
    expect(url).not.toContain(":append");
    expect(url).toContain("valueInputOption=USER_ENTERED");
  });

  test("sends POST for append mode", async () => {
    const mockFetch = mock(() => Promise.resolve(jsonResponse({})));
    globalThis.fetch = mockFetch;

    await updateSheet(ctx(), "Sheet1!A1:B2", [["a", "b"]], true);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(url).toContain(":append");
    expect(url).toContain("valueInputOption=USER_ENTERED");
  });

  test("includes values in request body", async () => {
    const mockFetch = mock(() => Promise.resolve(jsonResponse({})));
    globalThis.fetch = mockFetch;

    const values = [["row1col1", "row1col2"], ["row2col1", "row2col2"]];
    await updateSheet(ctx(), "Sheet1!A1:B2", values, false);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.values).toEqual(values);
  });

  test("includes Content-Type and Authorization headers", async () => {
    const mockFetch = mock(() => Promise.resolve(jsonResponse({})));
    globalThis.fetch = mockFetch;

    await updateSheet(ctx({ auth: "write-token" }), "Sheet1!A1", [[1]], false);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer write-token");
  });
});

// ---------------------------------------------------------------------------
// clearRange
// ---------------------------------------------------------------------------

describe("clearRange", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends POST to the :clear endpoint", async () => {
    const mockFetch = mock(() => Promise.resolve(jsonResponse({})));
    globalThis.fetch = mockFetch;

    await clearRange(ctx(), "Sheet1!A1:Z100");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(url).toContain(":clear");
    expect(url).toContain(`${SHEETS_API}/test-sheet-id/values/`);
  });

  test("includes Content-Type and Authorization headers", async () => {
    const mockFetch = mock(() => Promise.resolve(jsonResponse({})));
    globalThis.fetch = mockFetch;

    await clearRange(ctx({ auth: "clear-token" }), "Sheet1!A1:Z100");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer clear-token");
  });

  test("sends empty JSON object as body", async () => {
    const mockFetch = mock(() => Promise.resolve(jsonResponse({})));
    globalThis.fetch = mockFetch;

    await clearRange(ctx(), "Sheet1!A1:Z100");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({});
  });
});
