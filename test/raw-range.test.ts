/**
 * Tests for the raw range API (client.raw.readRange/writeRange/clearRange).
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { createClient } from "../src/client";
import { isGenjutsuError } from "../src/errors";
import type { SheetSchema } from "../src/types";
import { SHEETS_API } from "../src/transport";

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

const TestSchema: SheetSchema<{ id: string; name: string }> = {
  sheetName: "TestSheet",
  headers: ["id", "name"],
  readRange: "TestSheet!A2:B",
  writeRange: "TestSheet!A1:B",
  clearRange: "TestSheet!A2:B",
  primaryKey: "id",
  parseRow: (row) => {
    if (!row[0]) return null;
    return { id: String(row[0]), name: String(row[1] ?? "") };
  },
  toRow: (entity) => [entity.id, entity.name],
};

function makeClient(authOverride?: string | (() => Promise<string>)) {
  return createClient({
    spreadsheetId: "test-sheet-id",
    auth: authOverride ?? "test-token",
    schemas: { test: TestSchema },
  });
}

function makeReadOnlyClient() {
  return createClient({
    spreadsheetId: "test-sheet-id",
    apiKey: "test-api-key",
    schemas: { test: TestSchema },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

// ---------------------------------------------------------------------------
// readRange
// ---------------------------------------------------------------------------

describe("raw.readRange", () => {
  test("returns cell values as unknown[][]", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ values: [["blob-content"]] })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient();
    const result = await db.raw.readRange("Data!A1");

    expect(result).toEqual([["blob-content"]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain(`${SHEETS_API}/test-sheet-id/values/`);
    expect(url).toContain("Data!A1");
  });

  test("supports UNFORMATTED_VALUE render option", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ values: [[42]] })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient();
    const result = await db.raw.readRange("Data!A1", "UNFORMATTED_VALUE");

    expect(result).toEqual([[42]]);
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain("UNFORMATTED_VALUE");
  });

  test("defaults to FORMATTED_VALUE render option", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ values: [["$42.00"]] })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient();
    await db.raw.readRange("Data!A1");

    const url = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain("FORMATTED_VALUE");
  });

  test("returns empty array for empty range", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({})),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient();
    const result = await db.raw.readRange("Empty!A1:Z100");

    expect(result).toEqual([]);
  });

  test("works with read-only (apiKey) client", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ values: [["public-data"]] })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeReadOnlyClient();
    const result = await db.raw.readRange("Public!A1");

    expect(result).toEqual([["public-data"]]);
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain("key=test-api-key");
  });
});

// ---------------------------------------------------------------------------
// writeRange
// ---------------------------------------------------------------------------

describe("raw.writeRange", () => {
  test("writes values to specified range with overwrite semantics", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ updatedCells: 1 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient();
    await db.raw.writeRange("Data!A1", [["new-blob"]]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(url).toContain("Data!A1");
    expect(url).not.toContain(":append");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ values: [["new-blob"]] });
  });

  test("rejects with permission error on read-only client", async () => {
    const db = makeReadOnlyClient();

    try {
      await db.raw.writeRange("Data!A1", [["nope"]]);
      expect(true).toBe(false); // should not reach
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      if (isGenjutsuError(err)) {
        expect(err.kind).toBe("PERMISSION_ERROR");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// clearRange
// ---------------------------------------------------------------------------

describe("raw.clearRange", () => {
  test("clears the specified range", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(jsonResponse({ clearedRange: "Totals!A1:Z100" })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient();
    await db.raw.clearRange("Totals!A1:Z100");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain("Totals!A1%3AZ100:clear");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(init.method).toBe("POST");
  });

  test("rejects with permission error on read-only client", async () => {
    const db = makeReadOnlyClient();

    try {
      await db.raw.clearRange("Totals!A1:Z100");
      expect(true).toBe(false);
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      if (isGenjutsuError(err)) {
        expect(err.kind).toBe("PERMISSION_ERROR");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Error handling (US2)
// ---------------------------------------------------------------------------

describe("raw range error handling", () => {
  test("readRange throws AUTH_ERROR on 401", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient("static-token");
    try {
      await db.raw.readRange("Data!A1");
      expect(true).toBe(false);
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      if (isGenjutsuError(err)) {
        expect(err.kind).toBe("AUTH_ERROR");
      }
    }
  });

  test("readRange throws RATE_LIMIT on 429 with retryAfterMs", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "5" },
        }),
      ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient("static-token");
    try {
      await db.raw.readRange("Data!A1");
      expect(true).toBe(false);
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      if (isGenjutsuError(err)) {
        expect(err.kind).toBe("RATE_LIMIT");
        expect(err.retryAfterMs).toBe(5000);
      }
    }
  });

  test("writeRange throws NETWORK_ERROR on fetch failure", async () => {
    const fetchMock = mock(() =>
      Promise.reject(new Error("Network unreachable")),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient();
    try {
      await db.raw.writeRange("Data!A1", [["blob"]]);
      expect(true).toBe(false);
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      if (isGenjutsuError(err)) {
        expect(err.kind).toBe("NETWORK_ERROR");
      }
    }
  });

  test("clearRange throws PERMISSION_ERROR on 403", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response("Forbidden", { status: 403 })),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const db = makeClient();
    try {
      await db.raw.clearRange("Totals!A1:Z100");
      expect(true).toBe(false);
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      if (isGenjutsuError(err)) {
        expect(err.kind).toBe("PERMISSION_ERROR");
      }
    }
  });
});
