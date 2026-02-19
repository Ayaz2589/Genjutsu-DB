/**
 * Tests for the migration runner (src/migrations.ts).
 *
 * T034: Migration Runner Tests — runMigrations()
 * T035: MigrationContext Operation Tests — structural operations within up()
 *
 * These tests are TDD: they will fail until the migration implementation is complete.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { runMigrations } from "../src/migrations";
import { GenjutsuError } from "../src/errors";
import { SHEETS_API } from "../src/transport";
import type { TransportContext } from "../src/transport";
import type { Migration, MigrationContext } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

const ctx: TransportContext = { auth: "test-token", spreadsheetId: "test-id" };

/** Create a mock Response with JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Standard metadata response — returns sheet properties.
 * By default includes a single "Sheet1" with sheetId 0.
 */
function metadataResponse(
  sheets: { sheetId: number; title: string }[] = [
    { sheetId: 0, title: "Sheet1" },
  ],
): Response {
  return jsonResponse({
    sheets: sheets.map((s) => ({
      properties: { sheetId: s.sheetId, title: s.title },
    })),
  });
}

/**
 * Migrations sheet values response.
 * Each entry is [version, name, timestamp].
 */
function migrationsValuesResponse(
  rows: [number, string, string][] = [],
): Response {
  const values = rows.map(([v, n, t]) => [String(v), n, t]);
  return jsonResponse({ values });
}

/** Build a simple migration object. */
function makeMigration(
  version: number,
  name: string,
  upFn?: (ctx: MigrationContext) => Promise<void>,
): Migration {
  return {
    version,
    name,
    up: upFn ?? (async () => {}),
  };
}

/** Capture fetch calls for inspection. */
interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function captureFetchCalls(): { calls: FetchCall[]; mockFetch: typeof fetch } {
  const calls: FetchCall[] = [];
  const mockFetch = mock((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : null;
    calls.push({ url: urlStr, method, body });
    return Promise.resolve(jsonResponse({}));
  }) as unknown as typeof fetch;
  return { calls, mockFetch };
}

// ---------------------------------------------------------------------------
// T034: Migration Runner Tests
// ---------------------------------------------------------------------------

describe("runMigrations — migration runner", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -------------------------------------------------------------------------
  // Test 1: Creates _genjutsu_migrations sheet if missing
  // -------------------------------------------------------------------------

  test("creates _genjutsu_migrations sheet if missing", async () => {
    const calls: FetchCall[] = [];

    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url: urlStr, method, body });

      // Metadata: only Sheet1 exists, NO _genjutsu_migrations
      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(
          metadataResponse([{ sheetId: 0, title: "Sheet1" }]),
        );
      }

      // Values read for _genjutsu_migrations (after it's created) — empty
      if (urlStr.includes("/values/") && method === "GET") {
        return Promise.resolve(migrationsValuesResponse([]));
      }

      // batchUpdate (addSheet) or append — success
      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    await runMigrations(ctx, []);

    // Should have a structural batchUpdate with addSheet for _genjutsu_migrations
    const addSheetCall = calls.find(
      (c) =>
        c.url.includes(":batchUpdate") &&
        c.body &&
        JSON.stringify(c.body).includes("addSheet"),
    );
    expect(addSheetCall).toBeDefined();

    const requests = (addSheetCall!.body as { requests: Record<string, unknown>[] }).requests;
    const addSheetReq = requests.find(
      (r) => "addSheet" in r,
    ) as { addSheet: { properties: { title: string } } } | undefined;
    expect(addSheetReq).toBeDefined();
    expect(addSheetReq!.addSheet.properties.title).toBe("_genjutsu_migrations");
  });

  // -------------------------------------------------------------------------
  // Test 2: Reads applied versions and skips already-applied
  // -------------------------------------------------------------------------

  test("reads applied versions and skips already-applied", async () => {
    const upCalls: number[] = [];

    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      // Metadata: _genjutsu_migrations already exists
      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(
          metadataResponse([
            { sheetId: 0, title: "Sheet1" },
            { sheetId: 99, title: "_genjutsu_migrations" },
          ]),
        );
      }

      // Values read for _genjutsu_migrations — versions 1 and 2 already applied
      if (urlStr.includes("/values/") && method === "GET") {
        return Promise.resolve(
          migrationsValuesResponse([
            [1, "first", "2024-01-01T00:00:00.000Z"],
            [2, "second", "2024-01-02T00:00:00.000Z"],
          ]),
        );
      }

      // Append (recording migration) — success
      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    const migrations: Migration[] = [
      makeMigration(1, "first", async () => { upCalls.push(1); }),
      makeMigration(2, "second", async () => { upCalls.push(2); }),
      makeMigration(3, "third", async () => { upCalls.push(3); }),
    ];

    await runMigrations(ctx, migrations);

    // Only migration 3 should have been executed
    expect(upCalls).toEqual([3]);
  });

  // -------------------------------------------------------------------------
  // Test 3: Runs pending migrations in version order
  // -------------------------------------------------------------------------

  test("runs pending migrations in version order", async () => {
    const upCalls: number[] = [];

    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      // Metadata: _genjutsu_migrations already exists
      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(
          metadataResponse([
            { sheetId: 0, title: "Sheet1" },
            { sheetId: 99, title: "_genjutsu_migrations" },
          ]),
        );
      }

      // Empty migrations sheet — nothing applied yet
      if (urlStr.includes("/values/") && method === "GET") {
        return Promise.resolve(migrationsValuesResponse([]));
      }

      // Append/other — success
      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    // Pass migrations out of order: [3, 1, 2]
    const migrations: Migration[] = [
      makeMigration(3, "third", async () => { upCalls.push(3); }),
      makeMigration(1, "first", async () => { upCalls.push(1); }),
      makeMigration(2, "second", async () => { upCalls.push(2); }),
    ];

    await runMigrations(ctx, migrations);

    // up() calls should happen in ascending version order: 1, 2, 3
    expect(upCalls).toEqual([1, 2, 3]);
  });

  // -------------------------------------------------------------------------
  // Test 4: Records version/name/timestamp after each success
  // -------------------------------------------------------------------------

  test("records version/name/timestamp after each success", async () => {
    const appendCalls: FetchCall[] = [];

    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : null;

      // Metadata: _genjutsu_migrations exists
      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(
          metadataResponse([
            { sheetId: 0, title: "Sheet1" },
            { sheetId: 99, title: "_genjutsu_migrations" },
          ]),
        );
      }

      // Empty migrations sheet
      if (urlStr.includes("/values/") && method === "GET") {
        return Promise.resolve(migrationsValuesResponse([]));
      }

      // Capture append calls (recording migrations)
      if (urlStr.includes(":append")) {
        appendCalls.push({ url: urlStr, method, body });
        return Promise.resolve(jsonResponse({}));
      }

      // Other structural batchUpdate calls (from up() operations) — success
      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    const migrations: Migration[] = [
      makeMigration(1, "create-users", async () => {}),
    ];

    await runMigrations(ctx, migrations);

    // Should have recorded the migration via append to _genjutsu_migrations
    expect(appendCalls.length).toBe(1);

    const appendUrl = appendCalls[0].url;
    expect(appendUrl).toContain("_genjutsu_migrations");

    const values = (appendCalls[0].body as { values: unknown[][] }).values;
    expect(values.length).toBe(1);

    const [version, name, timestamp] = values[0] as [unknown, unknown, unknown];
    expect(version).toBe(1);
    expect(name).toBe("create-users");
    // Timestamp should be an ISO-ish string
    expect(typeof timestamp).toBe("string");
    expect((timestamp as string).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Test 5: Does NOT record failed migration
  // -------------------------------------------------------------------------

  test("does NOT record failed migration", async () => {
    const appendCalls: FetchCall[] = [];

    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : null;

      // Metadata: _genjutsu_migrations exists
      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(
          metadataResponse([
            { sheetId: 0, title: "Sheet1" },
            { sheetId: 99, title: "_genjutsu_migrations" },
          ]),
        );
      }

      // Empty migrations sheet
      if (urlStr.includes("/values/") && method === "GET") {
        return Promise.resolve(migrationsValuesResponse([]));
      }

      // Capture append calls
      if (urlStr.includes(":append")) {
        appendCalls.push({ url: urlStr, method, body });
        return Promise.resolve(jsonResponse({}));
      }

      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    const migrations: Migration[] = [
      makeMigration(1, "failing-migration", async () => {
        throw new Error("up() failed on purpose");
      }),
    ];

    // Should throw a MIGRATION_ERROR
    try {
      await runMigrations(ctx, migrations);
      throw new Error("Expected MIGRATION_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("MIGRATION_ERROR");
    }

    // No append calls — the failed migration was NOT recorded
    expect(appendCalls.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test 6: Wraps up() errors in MIGRATION_ERROR with version and name
  // -------------------------------------------------------------------------

  test("wraps up() errors in MIGRATION_ERROR with version and name", async () => {
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      // Metadata: _genjutsu_migrations exists
      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(
          metadataResponse([
            { sheetId: 0, title: "Sheet1" },
            { sheetId: 99, title: "_genjutsu_migrations" },
          ]),
        );
      }

      // Empty migrations sheet
      if (urlStr.includes("/values/") && method === "GET") {
        return Promise.resolve(migrationsValuesResponse([]));
      }

      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    const originalError = new Error("Something broke in up()");
    const migrations: Migration[] = [
      makeMigration(42, "add-columns", async () => {
        throw originalError;
      }),
    ];

    try {
      await runMigrations(ctx, migrations);
      throw new Error("Expected MIGRATION_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      const migErr = err as GenjutsuError;
      expect(migErr.kind).toBe("MIGRATION_ERROR");
      expect(migErr.migrationVersion).toBe(42);
      expect(migErr.migrationName).toBe("add-columns");
      expect(migErr.cause).toBe(originalError);
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: Rejects duplicate version numbers (SCHEMA_ERROR)
  // -------------------------------------------------------------------------

  test("rejects duplicate version numbers (SCHEMA_ERROR)", async () => {
    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(
          metadataResponse([
            { sheetId: 0, title: "Sheet1" },
            { sheetId: 99, title: "_genjutsu_migrations" },
          ]),
        );
      }

      if (urlStr.includes("/values/")) {
        return Promise.resolve(migrationsValuesResponse([]));
      }

      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    const migrations: Migration[] = [
      makeMigration(1, "first", async () => {}),
      makeMigration(1, "duplicate", async () => {}),
    ];

    try {
      await runMigrations(ctx, migrations);
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
      expect((err as GenjutsuError).message).toContain("duplicate");
    }
  });

  // -------------------------------------------------------------------------
  // Test 8: Rejects non-ascending version order (SCHEMA_ERROR)
  // -------------------------------------------------------------------------

  test("sorts non-ascending input and runs in version order", async () => {
    const upCalls: number[] = [];

    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";

      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(
          metadataResponse([
            { sheetId: 0, title: "Sheet1" },
            { sheetId: 99, title: "_genjutsu_migrations" },
          ]),
        );
      }

      if (urlStr.includes("/values/") && method === "GET") {
        return Promise.resolve(migrationsValuesResponse([]));
      }

      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    // Pass in descending order — runner should sort and execute ascending
    const migrations: Migration[] = [
      makeMigration(2, "second", async () => { upCalls.push(2); }),
      makeMigration(1, "first", async () => { upCalls.push(1); }),
    ];

    await runMigrations(ctx, migrations);
    expect(upCalls).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// T035: MigrationContext Operation Tests
// ---------------------------------------------------------------------------

describe("MigrationContext — structural operations", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Helper to run a single migration with a given up() function.
   * Handles the standard metadata + migrations-sheet mocks.
   * Returns all captured fetch calls for verification.
   */
  async function runSingleMigration(
    upFn: (ctx: MigrationContext) => Promise<void>,
    metadataSheets: { sheetId: number; title: string }[] = [
      { sheetId: 0, title: "Sheet1" },
      { sheetId: 99, title: "_genjutsu_migrations" },
    ],
  ): Promise<FetchCall[]> {
    const calls: FetchCall[] = [];

    globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : null;
      calls.push({ url: urlStr, method, body });

      // Metadata response
      if (urlStr.includes("fields=sheets.properties")) {
        return Promise.resolve(metadataResponse(metadataSheets));
      }

      // Migrations sheet values — empty (no applied migrations)
      if (urlStr.includes("/values/") && method === "GET") {
        return Promise.resolve(migrationsValuesResponse([]));
      }

      // All other requests (batchUpdate, append, etc.) — success
      return Promise.resolve(jsonResponse({}));
    }) as unknown as typeof fetch;

    const migrations: Migration[] = [
      makeMigration(1, "test-migration", upFn),
    ];

    await runMigrations(ctx, migrations);
    return calls;
  }

  // -------------------------------------------------------------------------
  // Test 9: createSheet() sends addSheet batchUpdate request
  // -------------------------------------------------------------------------

  test("createSheet() sends addSheet batchUpdate request", async () => {
    const calls = await runSingleMigration(async (mCtx) => {
      await mCtx.createSheet("NewSheet");
    });

    // Find a structural batchUpdate call containing addSheet for "NewSheet"
    const addSheetCall = calls.find(
      (c) =>
        c.url.includes(":batchUpdate") &&
        c.body &&
        JSON.stringify(c.body).includes("NewSheet"),
    );
    expect(addSheetCall).toBeDefined();

    const requests = (addSheetCall!.body as { requests: Record<string, unknown>[] }).requests;
    const addReq = requests.find(
      (r) => "addSheet" in r,
    ) as { addSheet: { properties: { title: string } } } | undefined;
    expect(addReq).toBeDefined();
    expect(addReq!.addSheet.properties.title).toBe("NewSheet");
  });

  // -------------------------------------------------------------------------
  // Test 10: addColumn() sends insertDimension + updateCells
  // -------------------------------------------------------------------------

  test("addColumn() sends insertDimension + updateCells", async () => {
    const calls = await runSingleMigration(async (mCtx) => {
      await mCtx.addColumn("Sheet1", "newCol", 2);
    });

    // Find a batchUpdate call that contains insertDimension
    const insertCall = calls.find(
      (c) =>
        c.url.includes(":batchUpdate") &&
        c.body &&
        JSON.stringify(c.body).includes("insertDimension"),
    );
    expect(insertCall).toBeDefined();

    const requests = (insertCall!.body as { requests: Record<string, unknown>[] }).requests;

    // Should have insertDimension request
    const insertReq = requests.find((r) => "insertDimension" in r);
    expect(insertReq).toBeDefined();

    // Should have updateCells request for the header cell
    const updateReq = requests.find((r) => "updateCells" in r);
    expect(updateReq).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 11: removeColumn() sends deleteDimension
  // -------------------------------------------------------------------------

  test("removeColumn() sends deleteDimension", async () => {
    const calls = await runSingleMigration(async (mCtx) => {
      await mCtx.removeColumn("Sheet1", 2);
    });

    // Find a batchUpdate call that contains deleteDimension
    const deleteCall = calls.find(
      (c) =>
        c.url.includes(":batchUpdate") &&
        c.body &&
        JSON.stringify(c.body).includes("deleteDimension"),
    );
    expect(deleteCall).toBeDefined();

    const requests = (deleteCall!.body as { requests: Record<string, unknown>[] }).requests;
    const deleteReq = requests.find((r) => "deleteDimension" in r);
    expect(deleteReq).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test 12: renameColumn() sends updateCells for header cell
  // -------------------------------------------------------------------------

  test("renameColumn() sends updateCells for header cell", async () => {
    const calls = await runSingleMigration(async (mCtx) => {
      await mCtx.renameColumn("Sheet1", 1, "renamedCol");
    });

    // Find a batchUpdate call that contains updateCells
    const updateCall = calls.find(
      (c) =>
        c.url.includes(":batchUpdate") &&
        c.body &&
        JSON.stringify(c.body).includes("updateCells"),
    );
    expect(updateCall).toBeDefined();

    const requests = (updateCall!.body as { requests: Record<string, unknown>[] }).requests;
    const updateReq = requests.find((r) => "updateCells" in r);
    expect(updateReq).toBeDefined();

    // Verify the cell value contains the new column name
    const bodyStr = JSON.stringify(updateReq);
    expect(bodyStr).toContain("renamedCol");
  });

  // -------------------------------------------------------------------------
  // Test 13: renameSheet() sends updateSheetProperties
  // -------------------------------------------------------------------------

  test("renameSheet() sends updateSheetProperties", async () => {
    const calls = await runSingleMigration(async (mCtx) => {
      await mCtx.renameSheet("Sheet1", "RenamedSheet");
    });

    // Find a batchUpdate call that contains updateSheetProperties
    const renameCall = calls.find(
      (c) =>
        c.url.includes(":batchUpdate") &&
        c.body &&
        JSON.stringify(c.body).includes("updateSheetProperties"),
    );
    expect(renameCall).toBeDefined();

    const requests = (renameCall!.body as { requests: Record<string, unknown>[] }).requests;
    const renameReq = requests.find(
      (r) => "updateSheetProperties" in r,
    ) as {
      updateSheetProperties: {
        properties: { sheetId: number; title: string };
        fields: string;
      };
    } | undefined;
    expect(renameReq).toBeDefined();

    // Should use sheetId 0 (mapped from "Sheet1" via metadata)
    expect(renameReq!.updateSheetProperties.properties.sheetId).toBe(0);
    expect(renameReq!.updateSheetProperties.properties.title).toBe("RenamedSheet");
    expect(renameReq!.updateSheetProperties.fields).toContain("title");
  });

  // -------------------------------------------------------------------------
  // Test 14: All operations resolve sheet name to sheetId via metadata fetch
  // -------------------------------------------------------------------------

  test("all operations resolve sheet name to sheetId via metadata fetch", async () => {
    const calls = await runSingleMigration(
      async (mCtx) => {
        // Use removeColumn which needs sheetId resolution for "CustomSheet"
        await mCtx.removeColumn("CustomSheet", 0);
      },
      [
        { sheetId: 77, title: "CustomSheet" },
        { sheetId: 99, title: "_genjutsu_migrations" },
      ],
    );

    // Verify metadata was fetched (to map "CustomSheet" -> sheetId 77)
    const metadataCall = calls.find(
      (c) => c.url.includes("fields=sheets.properties"),
    );
    expect(metadataCall).toBeDefined();

    // The deleteDimension request should reference sheetId 77
    const deleteCall = calls.find(
      (c) =>
        c.url.includes(":batchUpdate") &&
        c.body &&
        JSON.stringify(c.body).includes("deleteDimension"),
    );
    expect(deleteCall).toBeDefined();

    const requests = (deleteCall!.body as { requests: Record<string, unknown>[] }).requests;
    const deleteReq = requests.find((r) => "deleteDimension" in r) as {
      deleteDimension: {
        range: { sheetId: number; dimension: string; startIndex: number; endIndex: number };
      };
    } | undefined;
    expect(deleteReq).toBeDefined();
    expect(deleteReq!.deleteDimension.range.sheetId).toBe(77);
  });
});
