/**
 * Tests for the client factory and repository layer (src/client.ts).
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createClient } from "../src/client";
import { isGenjutsuError, GenjutsuError } from "../src/errors";
import type { SheetSchema } from "../src/types";
import { SHEETS_API } from "../src/transport";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

/** Create a mock Response with JSON body. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A simple test schema for a two-column sheet. */
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

/** A second schema for multi-schema tests. */
const OtherSchema: SheetSchema<{ code: string; value: number }> = {
  sheetName: "OtherSheet",
  headers: ["code", "value"],
  readRange: "OtherSheet!A2:B",
  writeRange: "OtherSheet!A1:B",
  clearRange: "OtherSheet!A2:B",
  primaryKey: "code",
  parseRow: (row) => {
    if (!row[0]) return null;
    return { code: String(row[0]), value: Number(row[1] ?? 0) };
  },
  toRow: (entity) => [entity.code, entity.value],
};

/** Schema with formatting rules for applyFormatting tests. */
const FormattedSchema: SheetSchema<{ id: string; amount: number }> = {
  sheetName: "FormattedSheet",
  headers: ["id", "amount"],
  readRange: "FormattedSheet!A2:B",
  writeRange: "FormattedSheet!A1:B",
  clearRange: "FormattedSheet!A2:B",
  primaryKey: "id",
  parseRow: (row) => {
    if (!row[0]) return null;
    return { id: String(row[0]), amount: Number(row[1] ?? 0) };
  },
  toRow: (entity) => [entity.id, entity.amount],
  headerFormatting: { bold: true, fontSize: 12 },
  formatting: [
    {
      startCol: 1,
      endCol: 2,
      numberFormat: { type: "NUMBER", pattern: "#,##0.00" },
    },
  ],
};

/** Valid config builder with auth. */
function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    spreadsheetId: "test-spreadsheet-id",
    auth: "test-token",
    schemas: { tests: TestSchema },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Client factory validation
// ---------------------------------------------------------------------------

describe("createClient — validation", () => {
  test("throws SCHEMA_ERROR for empty spreadsheetId", () => {
    try {
      createClient({
        spreadsheetId: "",
        auth: "token",
        schemas: { tests: TestSchema },
      });
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
      expect((err as GenjutsuError).message).toContain("spreadsheetId");
    }
  });

  test("throws SCHEMA_ERROR when neither auth nor apiKey provided", () => {
    try {
      createClient({
        spreadsheetId: "some-id",
        schemas: { tests: TestSchema },
      });
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
      expect((err as GenjutsuError).message).toContain("auth");
    }
  });

  test("throws SCHEMA_ERROR for no schemas (empty object)", () => {
    try {
      createClient({
        spreadsheetId: "some-id",
        auth: "token",
        schemas: {},
      });
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
      expect((err as GenjutsuError).message).toContain("At least one schema");
    }
  });

  test("throws SCHEMA_ERROR for schema with empty sheetName", () => {
    const badSchema: SheetSchema<{ id: string }> = {
      ...TestSchema,
      sheetName: "",
    };
    try {
      createClient({
        spreadsheetId: "some-id",
        auth: "token",
        schemas: { bad: badSchema },
      });
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
      expect((err as GenjutsuError).message).toContain("empty sheetName");
    }
  });

  test("throws SCHEMA_ERROR for schema with empty headers", () => {
    const badSchema: SheetSchema<{ id: string }> = {
      ...TestSchema,
      sheetName: "Valid",
      headers: [],
    };
    try {
      createClient({
        spreadsheetId: "some-id",
        auth: "token",
        schemas: { bad: badSchema },
      });
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
      expect((err as GenjutsuError).message).toContain("empty headers");
    }
  });

  test("throws SCHEMA_ERROR for duplicate sheetNames", () => {
    const schema1: SheetSchema<{ id: string; name: string }> = {
      ...TestSchema,
      sheetName: "SameName",
    };
    const schema2: SheetSchema<{ id: string; name: string }> = {
      ...TestSchema,
      sheetName: "SameName",
    };
    try {
      createClient({
        spreadsheetId: "some-id",
        auth: "token",
        schemas: { first: schema1, second: schema2 },
      });
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
      expect((err as GenjutsuError).message).toContain("Duplicate sheetName");
    }
  });

  test("throws SCHEMA_ERROR for reserved name _genjutsu_migrations", () => {
    const reservedSchema: SheetSchema<{ id: string; name: string }> = {
      ...TestSchema,
      sheetName: "_genjutsu_migrations",
    };
    try {
      createClient({
        spreadsheetId: "some-id",
        auth: "token",
        schemas: { reserved: reservedSchema },
      });
      throw new Error("Expected SCHEMA_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("SCHEMA_ERROR");
      expect((err as GenjutsuError).message).toContain("reserved sheet name");
    }
  });

  test("creates client successfully with valid config (auth + schemas)", () => {
    const client = createClient(validConfig());
    expect(client).toBeDefined();
    expect(typeof client.repo).toBe("function");
    expect(typeof client.batchSync).toBe("function");
    expect(typeof client.ensureSchema).toBe("function");
    expect(typeof client.applyFormatting).toBe("function");
    expect(typeof client.migrate).toBe("function");
    expect(typeof client.extractSpreadsheetId).toBe("function");
  });

  test("creates client successfully with apiKey only", () => {
    const client = createClient({
      spreadsheetId: "some-id",
      apiKey: "my-api-key",
      schemas: { tests: TestSchema },
    });
    expect(client).toBeDefined();
    expect(typeof client.repo).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// repo() accessor
// ---------------------------------------------------------------------------

describe("repo() accessor", () => {
  test("returns a repository for a valid key", () => {
    const client = createClient(validConfig());
    const repo = client.repo("tests");
    expect(repo).toBeDefined();
    expect(typeof repo.readAll).toBe("function");
    expect(typeof repo.writeAll).toBe("function");
    expect(typeof repo.append).toBe("function");
    expect(typeof repo.create).toBe("function");
    expect(typeof repo.update).toBe("function");
    expect(typeof repo.delete).toBe("function");
    expect(typeof repo.findById).toBe("function");
    expect(typeof repo.findMany).toBe("function");
  });

  test("returns the same repo instance on repeated calls", () => {
    const client = createClient(validConfig());
    const repo1 = client.repo("tests");
    const repo2 = client.repo("tests");
    expect(repo1).toBe(repo2);
  });
});

// ---------------------------------------------------------------------------
// Write-blocking for apiKey-only
// ---------------------------------------------------------------------------

describe("write-blocking for apiKey-only client", () => {
  beforeEach(() => {
    // Mock fetch for readAll (the one operation that should succeed)
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse({ values: [["1", "Alice"]] })),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function readOnlyClient() {
    return createClient({
      spreadsheetId: "some-id",
      apiKey: "read-only-key",
      schemas: { tests: TestSchema },
    });
  }

  test("repo.writeAll() throws PERMISSION_ERROR", async () => {
    const client = readOnlyClient();
    try {
      await client.repo("tests").writeAll([]);
      throw new Error("Expected PERMISSION_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("repo.append() throws PERMISSION_ERROR", async () => {
    const client = readOnlyClient();
    try {
      await client.repo("tests").append([{ id: "1", name: "A" }]);
      throw new Error("Expected PERMISSION_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("repo.create() throws PERMISSION_ERROR", async () => {
    const client = readOnlyClient();
    try {
      await client.repo("tests").create({ id: "1", name: "A" });
      throw new Error("Expected PERMISSION_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("repo.update() throws PERMISSION_ERROR", async () => {
    const client = readOnlyClient();
    try {
      await client.repo("tests").update("1", { name: "B" });
      throw new Error("Expected PERMISSION_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("repo.delete() throws PERMISSION_ERROR", async () => {
    const client = readOnlyClient();
    try {
      await client.repo("tests").delete("1");
      throw new Error("Expected PERMISSION_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("batchSync() throws PERMISSION_ERROR", async () => {
    const client = readOnlyClient();
    try {
      await client.batchSync({ tests: [] });
      throw new Error("Expected PERMISSION_ERROR to be thrown");
    } catch (err) {
      expect(isGenjutsuError(err)).toBe(true);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("repo.readAll() works (reads are allowed)", async () => {
    const client = readOnlyClient();
    const result = await client.repo("tests").readAll();
    expect(result).toEqual([{ id: "1", name: "Alice" }]);
  });
});

// ---------------------------------------------------------------------------
// batchSync
// ---------------------------------------------------------------------------

describe("batchSync", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls batchClear then batchUpdate (2 POST calls)", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const mockFetch = mock((url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body as string) : null,
      });
      return Promise.resolve(jsonResponse({}));
    });
    globalThis.fetch = mockFetch;

    const client = createClient({
      spreadsheetId: "batch-sheet-id",
      auth: "token",
      schemas: { tests: TestSchema, others: OtherSchema },
    });

    await client.batchSync({
      tests: [{ id: "1", name: "Alice" }],
      others: [{ code: "X", value: 42 }],
    });

    // Should have exactly 2 POST calls: batchClear then batchUpdate
    expect(calls.length).toBe(2);

    // First call: batchClear
    expect(calls[0].url).toContain(":batchClear");
    expect(calls[0].method).toBe("POST");
    expect((calls[0].body as { ranges: string[] }).ranges).toContain("TestSheet!A2:B");
    expect((calls[0].body as { ranges: string[] }).ranges).toContain("OtherSheet!A2:B");

    // Second call: batchUpdate
    expect(calls[1].url).toContain(":batchUpdate");
    expect(calls[1].method).toBe("POST");
    const updateBody = calls[1].body as {
      data: { range: string; values: unknown[][] }[];
      valueInputOption: string;
    };
    expect(updateBody.valueInputOption).toBe("USER_ENTERED");
    expect(updateBody.data.length).toBe(2);

    // Verify TestSheet data includes headers + rows
    const testSheetData = updateBody.data.find((d) => d.range === "TestSheet!A1:B");
    expect(testSheetData).toBeDefined();
    expect(testSheetData!.values).toEqual([
      ["id", "name"],
      ["1", "Alice"],
    ]);

    // Verify OtherSheet data includes headers + rows
    const otherSheetData = updateBody.data.find((d) => d.range === "OtherSheet!A1:B");
    expect(otherSheetData).toBeDefined();
    expect(otherSheetData!.values).toEqual([
      ["code", "value"],
      ["X", 42],
    ]);
  });
});

// ---------------------------------------------------------------------------
// ensureSchema
// ---------------------------------------------------------------------------

describe("ensureSchema", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("creates missing sheets when they don't exist", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const mockFetch = mock((url: string, init: RequestInit) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body as string) : null,
      });

      // First call: getSpreadsheetMetadata — only "OtherSheet" exists
      if (url.includes("fields=sheets.properties")) {
        return Promise.resolve(
          jsonResponse({
            sheets: [
              { properties: { sheetId: 0, title: "OtherSheet" } },
            ],
          }),
        );
      }

      // Second call: structuralBatchUpdate to add missing sheets
      return Promise.resolve(jsonResponse({}));
    });
    globalThis.fetch = mockFetch;

    const client = createClient({
      spreadsheetId: "ensure-id",
      auth: "token",
      schemas: { tests: TestSchema, others: OtherSchema },
    });

    await client.ensureSchema();

    // Should have 2 calls: metadata GET + structural batchUpdate POST
    expect(calls.length).toBe(2);

    // The second call should be the batchUpdate to add "TestSheet"
    expect(calls[1].url).toContain(":batchUpdate");
    const batchBody = calls[1].body as { requests: Record<string, unknown>[] };
    expect(batchBody.requests.length).toBe(1);
    expect(batchBody.requests[0]).toEqual({
      addSheet: { properties: { title: "TestSheet" } },
    });
  });

  test("does nothing when all sheets exist", async () => {
    const calls: string[] = [];
    const mockFetch = mock((url: string) => {
      calls.push(url);

      // Metadata response: both sheets exist
      if (url.includes("fields=sheets.properties")) {
        return Promise.resolve(
          jsonResponse({
            sheets: [
              { properties: { sheetId: 0, title: "TestSheet" } },
              { properties: { sheetId: 1, title: "OtherSheet" } },
            ],
          }),
        );
      }

      return Promise.resolve(jsonResponse({}));
    });
    globalThis.fetch = mockFetch;

    const client = createClient({
      spreadsheetId: "ensure-id",
      auth: "token",
      schemas: { tests: TestSchema, others: OtherSchema },
    });

    await client.ensureSchema();

    // Only the metadata call, no batchUpdate
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain("fields=sheets.properties");
  });
});

// ---------------------------------------------------------------------------
// applyFormatting
// ---------------------------------------------------------------------------

describe("applyFormatting", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends repeatCell requests for schemas with formatting", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const mockFetch = mock((url: string, init: RequestInit) => {
      calls.push({
        url,
        body: init.body ? JSON.parse(init.body as string) : null,
      });

      // Metadata response
      if (url.includes("fields=sheets.properties")) {
        return Promise.resolve(
          jsonResponse({
            sheets: [
              { properties: { sheetId: 42, title: "FormattedSheet" } },
            ],
          }),
        );
      }

      return Promise.resolve(jsonResponse({}));
    });
    globalThis.fetch = mockFetch;

    const client = createClient({
      spreadsheetId: "fmt-id",
      auth: "token",
      schemas: { formatted: FormattedSchema },
    });

    await client.applyFormatting();

    // Should have 2 calls: metadata GET + structural batchUpdate POST
    expect(calls.length).toBe(2);
    expect(calls[1].url).toContain(":batchUpdate");

    const batchBody = calls[1].body as { requests: Record<string, unknown>[] };
    // Should have 2 requests: one for headerFormatting, one for data formatting
    expect(batchBody.requests.length).toBe(2);

    // Verify header formatting request
    const headerReq = batchBody.requests[0] as {
      repeatCell: {
        range: { sheetId: number; startRowIndex: number; endRowIndex: number };
        cell: { userEnteredFormat: Record<string, unknown> };
        fields: string;
      };
    };
    expect(headerReq.repeatCell).toBeDefined();
    expect(headerReq.repeatCell.range.sheetId).toBe(42);
    expect(headerReq.repeatCell.range.startRowIndex).toBe(0);
    expect(headerReq.repeatCell.range.endRowIndex).toBe(1);
    expect(headerReq.repeatCell.cell.userEnteredFormat.textFormat).toEqual({
      bold: true,
      fontSize: 12,
    });

    // Verify data formatting request (numberFormat)
    const dataReq = batchBody.requests[1] as {
      repeatCell: {
        range: {
          sheetId: number;
          startRowIndex: number;
          endRowIndex: number;
          startColumnIndex: number;
          endColumnIndex: number;
        };
        cell: { userEnteredFormat: Record<string, unknown> };
        fields: string;
      };
    };
    expect(dataReq.repeatCell).toBeDefined();
    expect(dataReq.repeatCell.range.sheetId).toBe(42);
    expect(dataReq.repeatCell.range.startColumnIndex).toBe(1);
    expect(dataReq.repeatCell.range.endColumnIndex).toBe(2);
    expect(dataReq.repeatCell.cell.userEnteredFormat.numberFormat).toEqual({
      type: "NUMBER",
      pattern: "#,##0.00",
    });
    expect(dataReq.repeatCell.fields).toContain("userEnteredFormat.numberFormat");
  });

  test("does nothing when no schemas have formatting", async () => {
    const calls: string[] = [];
    const mockFetch = mock((url: string) => {
      calls.push(url);
      return Promise.resolve(jsonResponse({}));
    });
    globalThis.fetch = mockFetch;

    // TestSchema has no formatting rules
    const client = createClient({
      spreadsheetId: "no-fmt-id",
      auth: "token",
      schemas: { tests: TestSchema },
    });

    await client.applyFormatting();

    // No fetch calls at all — early return before metadata fetch
    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

describe("CRUD operations", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function crudClient() {
    return createClient({
      spreadsheetId: "test-spreadsheet-id",
      auth: "test-token",
      schemas: { tests: TestSchema },
    });
  }

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------

  describe("create()", () => {
    test("appends record and returns it", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body ? JSON.parse(init.body as string) : null,
        });

        // First call: readAll to check PK — return empty (no existing records)
        if (url.includes("/values/TestSheet") && !init.method) {
          return Promise.resolve(jsonResponse({ values: [] }));
        }

        // Second call: append
        if (url.includes(":append")) {
          return Promise.resolve(jsonResponse({}));
        }

        return Promise.resolve(jsonResponse({}));
      });

      const client = crudClient();
      const result = await client.repo("tests").create({ id: "1", name: "Alice" });

      expect(result).toEqual({ id: "1", name: "Alice" });

      // Calls: readAll (GET for PK check) + header check (GET) + write headers (PUT) + append (POST)
      expect(calls.length).toBe(4);
      expect(calls[0].method).toBe("GET"); // PK check
      expect(calls[0].url).toContain("TestSheet");
      expect(calls[1].method).toBe("GET"); // header check
      expect(calls[2].method).toBe("PUT"); // write headers
      expect(calls[3].method).toBe("POST"); // append
      expect(calls[3].url).toContain(":append");
      expect((calls[3].body as { values: unknown[][] }).values).toEqual([
        ["1", "Alice"],
      ]);
    });

    test("rejects duplicate primary key", async () => {
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        // readAll returns existing record with id "1"
        if (url.includes("/values/TestSheet") && !init.method) {
          return Promise.resolve(
            jsonResponse({ values: [["1", "Alice"]] }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });

      const client = crudClient();
      try {
        await client.repo("tests").create({ id: "1", name: "Duplicate" });
        throw new Error("Expected VALIDATION_ERROR to be thrown");
      } catch (err) {
        expect(isGenjutsuError(err)).toBe(true);
        expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
        expect((err as GenjutsuError).message).toContain("Duplicate primary key");
      }
    });
  });

  // -------------------------------------------------------------------------
  // findById()
  // -------------------------------------------------------------------------

  describe("findById()", () => {
    test("returns matching record", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          jsonResponse({ values: [["1", "Alice"], ["2", "Bob"]] }),
        ),
      );

      const client = crudClient();
      const result = await client.repo("tests").findById("1");
      expect(result).toEqual({ id: "1", name: "Alice" });
    });

    test("returns null when not found", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          jsonResponse({ values: [["1", "Alice"], ["2", "Bob"]] }),
        ),
      );

      const client = crudClient();
      const result = await client.repo("tests").findById("999");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findMany()
  // -------------------------------------------------------------------------

  describe("findMany()", () => {
    test("without filter returns all records", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          jsonResponse({ values: [["1", "Alice"], ["2", "Bob"], ["3", "Ada"]] }),
        ),
      );

      const client = crudClient();
      const results = await client.repo("tests").findMany();
      expect(results).toEqual([
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
        { id: "3", name: "Ada" },
      ]);
    });

    test("with filter returns only matching records", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          jsonResponse({ values: [["1", "Alice"], ["2", "Bob"], ["3", "Ada"]] }),
        ),
      );

      const client = crudClient();
      const results = await client
        .repo("tests")
        .findMany((item) => item.name.includes("A"));
      expect(results).toEqual([
        { id: "1", name: "Alice" },
        { id: "3", name: "Ada" },
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // update()
  // -------------------------------------------------------------------------

  describe("update()", () => {
    test("merges partial changes and rewrites", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body ? JSON.parse(init.body as string) : null,
        });

        // readAll — return existing records
        if (url.includes("/values/TestSheet") && !init.method) {
          return Promise.resolve(
            jsonResponse({ values: [["1", "Alice"], ["2", "Bob"]] }),
          );
        }

        // clear + write both succeed
        return Promise.resolve(jsonResponse({}));
      });

      const client = crudClient();
      const updated = await client.repo("tests").update("1", { name: "Updated" });

      expect(updated).toEqual({ id: "1", name: "Updated" });

      // Should have 3 calls: readAll (GET), clear (POST), write (PUT)
      expect(calls.length).toBe(3);
      expect(calls[0].method).toBe("GET");
      expect(calls[1].method).toBe("POST");
      expect(calls[1].url).toContain(":clear");
      expect(calls[2].method).toBe("PUT");

      // Verify the written data includes headers + all records with the update
      const writeBody = calls[2].body as { values: unknown[][] };
      expect(writeBody.values).toEqual([
        ["id", "name"],
        ["1", "Updated"],
        ["2", "Bob"],
      ]);
    });

    test("throws VALIDATION_ERROR if record not found", async () => {
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        // readAll — return existing records (no id "999")
        if (url.includes("/values/TestSheet") && !init.method) {
          return Promise.resolve(
            jsonResponse({ values: [["1", "Alice"], ["2", "Bob"]] }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      });

      const client = crudClient();
      try {
        await client.repo("tests").update("999", { name: "Ghost" });
        throw new Error("Expected VALIDATION_ERROR to be thrown");
      } catch (err) {
        expect(isGenjutsuError(err)).toBe(true);
        expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
        expect((err as GenjutsuError).message).toContain("Record not found");
      }
    });
  });

  // -------------------------------------------------------------------------
  // delete()
  // -------------------------------------------------------------------------

  describe("delete()", () => {
    test("removes record and rewrites remaining", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body ? JSON.parse(init.body as string) : null,
        });

        // readAll — return existing records
        if (url.includes("/values/TestSheet") && !init.method) {
          return Promise.resolve(
            jsonResponse({ values: [["1", "Alice"], ["2", "Bob"]] }),
          );
        }

        // clear + write both succeed
        return Promise.resolve(jsonResponse({}));
      });

      const client = crudClient();
      await client.repo("tests").delete("1");

      // Should have 3 calls: readAll (GET), clear (POST), write (PUT)
      expect(calls.length).toBe(3);
      expect(calls[0].method).toBe("GET");
      expect(calls[1].method).toBe("POST");
      expect(calls[1].url).toContain(":clear");
      expect(calls[2].method).toBe("PUT");

      // Verify the written data only contains the remaining record
      const writeBody = calls[2].body as { values: unknown[][] };
      expect(writeBody.values).toEqual([
        ["id", "name"],
        ["2", "Bob"],
      ]);
    });

    test("is no-op if ID not found (still rewrites same records)", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body ? JSON.parse(init.body as string) : null,
        });

        // readAll — return existing records
        if (url.includes("/values/TestSheet") && !init.method) {
          return Promise.resolve(
            jsonResponse({ values: [["1", "Alice"], ["2", "Bob"]] }),
          );
        }

        // clear + write both succeed
        return Promise.resolve(jsonResponse({}));
      });

      const client = crudClient();
      await client.repo("tests").delete("999");

      // Should still have 3 calls: readAll + clear + write
      expect(calls.length).toBe(3);

      // Written data should be unchanged (all original records remain)
      const writeBody = calls[2].body as { values: unknown[][] };
      expect(writeBody.values).toEqual([
        ["id", "name"],
        ["1", "Alice"],
        ["2", "Bob"],
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // readAll() / writeAll() / append() alongside CRUD (regression check)
  // -------------------------------------------------------------------------

  describe("readAll/writeAll/append alongside CRUD", () => {
    test("readAll still works after CRUD client creation", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          jsonResponse({ values: [["1", "Alice"], ["2", "Bob"]] }),
        ),
      );

      const client = crudClient();
      const results = await client.repo("tests").readAll();
      expect(results).toEqual([
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
      ]);
    });

    test("writeAll still works after CRUD client creation", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body ? JSON.parse(init.body as string) : null,
        });
        return Promise.resolve(jsonResponse({}));
      });

      const client = crudClient();
      await client
        .repo("tests")
        .writeAll([{ id: "1", name: "New" }]);

      // writeAll does clear + write (2 calls)
      expect(calls.length).toBe(2);
      expect(calls[0].url).toContain(":clear");
      expect(calls[1].method).toBe("PUT");
      const writeBody = calls[1].body as { values: unknown[][] };
      expect(writeBody.values).toEqual([
        ["id", "name"],
        ["1", "New"],
      ]);
    });

    test("append still works after CRUD client creation", async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      globalThis.fetch = mock((url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body ? JSON.parse(init.body as string) : null,
        });
        return Promise.resolve(jsonResponse({}));
      });

      const client = crudClient();
      await client
        .repo("tests")
        .append([{ id: "3", name: "Charlie" }]);

      // Calls: header check (GET) + write headers (PUT) + append (POST)
      expect(calls.length).toBe(3);
      expect(calls[0].method).toBe("GET"); // header check
      expect(calls[1].method).toBe("PUT"); // write headers
      expect(calls[2].method).toBe("POST"); // append
      expect(calls[2].url).toContain(":append");
      const appendBody = calls[2].body as { values: unknown[][] };
      expect(appendBody.values).toEqual([["3", "Charlie"]]);
    });
  });
});

// ---------------------------------------------------------------------------
// Raw SheetSchema<T> without defineModel
// ---------------------------------------------------------------------------

describe("Raw SheetSchema<T> without defineModel", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** A manually created raw schema with no helpers. */
  const RawSchema: SheetSchema<{ key: string; label: string }> = {
    sheetName: "RawSheet",
    headers: ["key", "label"],
    readRange: "RawSheet!A2:B",
    writeRange: "RawSheet!A1:B",
    clearRange: "RawSheet!A2:B",
    primaryKey: "key",
    parseRow: (row) => {
      if (!row[0]) return null;
      return { key: String(row[0]), label: String(row[1] ?? "") };
    },
    toRow: (entity) => [entity.key, entity.label],
  };

  function rawClient() {
    return createClient({
      spreadsheetId: "raw-spreadsheet-id",
      auth: "raw-token",
      schemas: { raw: RawSchema },
    });
  }

  test("create works with raw schema", async () => {
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      // readAll — no existing records
      if (url.includes("/values/RawSheet") && !init.method) {
        return Promise.resolve(jsonResponse({ values: [] }));
      }
      // append
      return Promise.resolve(jsonResponse({}));
    });

    const client = rawClient();
    const result = await client
      .repo("raw")
      .create({ key: "k1", label: "Label One" });
    expect(result).toEqual({ key: "k1", label: "Label One" });
  });

  test("findById works with raw schema", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({ values: [["k1", "Label One"], ["k2", "Label Two"]] }),
      ),
    );

    const client = rawClient();
    const result = await client.repo("raw").findById("k2");
    expect(result).toEqual({ key: "k2", label: "Label Two" });
  });

  test("update works with raw schema", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body as string) : null,
      });

      // readAll
      if (url.includes("/values/RawSheet") && !init.method) {
        return Promise.resolve(
          jsonResponse({ values: [["k1", "Label One"], ["k2", "Label Two"]] }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const client = rawClient();
    const updated = await client
      .repo("raw")
      .update("k1", { label: "Updated Label" });
    expect(updated).toEqual({ key: "k1", label: "Updated Label" });

    // Verify clear + write happened
    const clearCall = calls.find((c) => c.url.includes(":clear"));
    expect(clearCall).toBeDefined();
    const writeCall = calls.find((c) => c.method === "PUT");
    expect(writeCall).toBeDefined();
    const writeBody = writeCall!.body as { values: unknown[][] };
    expect(writeBody.values).toEqual([
      ["key", "label"],
      ["k1", "Updated Label"],
      ["k2", "Label Two"],
    ]);
  });

  test("delete works with raw schema", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = mock((url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body as string) : null,
      });

      // readAll
      if (url.includes("/values/RawSheet") && !init.method) {
        return Promise.resolve(
          jsonResponse({ values: [["k1", "Label One"], ["k2", "Label Two"]] }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const client = rawClient();
    await client.repo("raw").delete("k1");

    // Verify the written data excludes the deleted record
    const writeCall = calls.find((c) => c.method === "PUT");
    expect(writeCall).toBeDefined();
    const writeBody = writeCall!.body as { values: unknown[][] };
    expect(writeBody.values).toEqual([
      ["key", "label"],
      ["k2", "Label Two"],
    ]);
  });
});
