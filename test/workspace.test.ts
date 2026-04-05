/**
 * Tests for the workspace orchestrator (src/workspace.ts).
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { GenjutsuError } from "../src/errors";
import { resolveWorkspace } from "../src/workspace";
import type { WorkspaceConfig } from "../src/types";

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

function baseConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    appId: "test-app",
    defaultSpreadsheetName: "Test Data",
    auth: "test-token",
    ...overrides,
  };
}

/**
 * Build a mock fetch that returns different responses based on URL patterns.
 * Routes: findFolder, createFolder, listSheets, createSheet
 */
function buildMockFetch(routes: {
  findFolder?: unknown;
  createFolder?: unknown;
  listSheets?: unknown;
  createSheet?: unknown;
}) {
  return mock((url: string) => {
    // POST requests (create folder or create spreadsheet)
    if (typeof url === "string" && url.includes("supportsAllDrives=true") && !url.includes("q=")) {
      // Distinguish by what was already called — but since we can't easily
      // check the body in this mock pattern, we track call order.
      // The order is: findFolder → createFolder → listSheets → createSheet
      // createFolder and createSheet are both POSTs, so we track them by call count.
    }

    // GET with appProperties query = findFolder
    if (url.includes("genjutsuApp")) {
      return Promise.resolve(jsonResponse(routes.findFolder ?? { files: [] }));
    }

    // GET with 'in parents' = listSheets
    if (url.includes("in+parents") || url.includes("in%20parents")) {
      return Promise.resolve(jsonResponse(routes.listSheets ?? { files: [] }));
    }

    // POST = createFolder or createSheet (returns the appropriate one)
    // We need to distinguish between folder and sheet creation
    return Promise.resolve(jsonResponse(routes.createFolder ?? routes.createSheet ?? {}));
  });
}

/**
 * Build a mock fetch with call-order tracking for precise control.
 */
function buildSequentialMock(responses: Array<unknown>) {
  let callIndex = 0;
  return mock(() => {
    const response = responses[callIndex] ?? {};
    callIndex++;
    return Promise.resolve(jsonResponse(response));
  });
}

// ---------------------------------------------------------------------------
// resolveWorkspace — First-time setup
// ---------------------------------------------------------------------------

describe("resolveWorkspace — first-time setup", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("creates folder and spreadsheet when nothing exists", async () => {
    // Call sequence: findFolder (empty) → createFolder → listSheets (empty) → createSheet
    const mockFetch = buildSequentialMock([
      { files: [] }, // findFolder: no folder
      { id: "folder-1", name: "Test App" }, // createFolder
      { files: [] }, // listSheets: empty
      { id: "sheet-1", name: "Test Data" }, // createSheet
    ]);
    globalThis.fetch = mockFetch;

    const result = await resolveWorkspace(baseConfig());

    expect(result.folderId).toBe("folder-1");
    expect(result.spreadsheetId).toBe("sheet-1");
    expect(result.spreadsheets).toEqual([{ id: "sheet-1", name: "Test Data" }]);
    expect(result.created).toBe(true);
    expect(mockFetch.mock.calls.length).toBe(4);
  });

  test("uses folderName config for display name", async () => {
    const mockFetch = buildSequentialMock([
      { files: [] },
      { id: "f1", name: "My Budget" },
      { files: [] },
      { id: "s1", name: "Budget Data" },
    ]);
    globalThis.fetch = mockFetch;

    await resolveWorkspace(
      baseConfig({ folderName: "My Budget", defaultSpreadsheetName: "Budget Data" }),
    );

    // Second call is createFolder — check the body
    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe("My Budget");
  });

  test("defaults folderName to appId when not provided", async () => {
    const mockFetch = buildSequentialMock([
      { files: [] },
      { id: "f1", name: "test-app" },
      { files: [] },
      { id: "s1", name: "Test Data" },
    ]);
    globalThis.fetch = mockFetch;

    await resolveWorkspace(baseConfig({ appId: "test-app" }));

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe("test-app");
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspace — Returning user
// ---------------------------------------------------------------------------

describe("resolveWorkspace — returning user", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("finds existing folder and spreadsheet", async () => {
    // Call sequence: findFolder (found) → listSheets (has sheet)
    const mockFetch = buildSequentialMock([
      { files: [{ id: "folder-1", name: "Budget" }] }, // findFolder
      { files: [{ id: "sheet-1", name: "Budget Data" }] }, // listSheets
    ]);
    globalThis.fetch = mockFetch;

    const result = await resolveWorkspace(baseConfig());

    expect(result.folderId).toBe("folder-1");
    expect(result.spreadsheetId).toBe("sheet-1");
    expect(result.spreadsheets).toEqual([{ id: "sheet-1", name: "Budget Data" }]);
    expect(result.created).toBe(false);
    expect(mockFetch.mock.calls.length).toBe(2);
  });

  test("creates spreadsheet when folder exists but is empty", async () => {
    // Call sequence: findFolder (found) → listSheets (empty) → createSheet
    const mockFetch = buildSequentialMock([
      { files: [{ id: "folder-1", name: "Budget" }] }, // findFolder
      { files: [] }, // listSheets: empty
      { id: "new-sheet", name: "Test Data" }, // createSheet
    ]);
    globalThis.fetch = mockFetch;

    const result = await resolveWorkspace(baseConfig());

    expect(result.folderId).toBe("folder-1");
    expect(result.spreadsheetId).toBe("new-sheet");
    expect(result.created).toBe(true);
    expect(mockFetch.mock.calls.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspace — Multiple spreadsheets
// ---------------------------------------------------------------------------

describe("resolveWorkspace — multiple spreadsheets", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns all spreadsheets and picks the first as primary", async () => {
    const mockFetch = buildSequentialMock([
      { files: [{ id: "folder-1", name: "App" }] },
      {
        files: [
          { id: "sheet-a", name: "2026 Data" },
          { id: "sheet-b", name: "2025 Data" },
          { id: "sheet-c", name: "Archive" },
        ],
      },
    ]);
    globalThis.fetch = mockFetch;

    const result = await resolveWorkspace(baseConfig());

    expect(result.spreadsheetId).toBe("sheet-a");
    expect(result.spreadsheets).toEqual([
      { id: "sheet-a", name: "2026 Data" },
      { id: "sheet-b", name: "2025 Data" },
      { id: "sheet-c", name: "Archive" },
    ]);
    expect(result.created).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspace — Isolation
// ---------------------------------------------------------------------------

describe("resolveWorkspace — isolation", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("appProperties query only matches tagged folders (not user's personal folders)", async () => {
    // The mock returns only folders that match the appProperties query.
    // A personal "Budget" folder without appProperties would NOT be in Drive API results.
    const mockFetch = buildSequentialMock([
      { files: [{ id: "tagged-folder", name: "Budget" }] },
      { files: [{ id: "sheet-1", name: "Data" }] },
    ]);
    globalThis.fetch = mockFetch;

    const result = await resolveWorkspace(baseConfig({ appId: "budget" }));

    // Verify the query includes appProperties filter
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("genjutsuApp");
    expect(url).toContain("budget");

    expect(result.folderId).toBe("tagged-folder");
  });

  test("most recently modified folder is selected when multiple tagged folders exist", async () => {
    const mockFetch = buildSequentialMock([
      {
        files: [
          { id: "newest", name: "Budget", modifiedTime: "2026-03-01" },
          { id: "oldest", name: "Budget", modifiedTime: "2026-01-01" },
        ],
      },
      { files: [{ id: "sheet-1", name: "Data" }] },
    ]);
    globalThis.fetch = mockFetch;

    const result = await resolveWorkspace(baseConfig());
    expect(result.folderId).toBe("newest");
  });
});

// ---------------------------------------------------------------------------
// resolveWorkspace — Validation errors
// ---------------------------------------------------------------------------

describe("resolveWorkspace — validation", () => {
  test("throws VALIDATION_ERROR when auth is missing", async () => {
    try {
      await resolveWorkspace({
        appId: "test",
        defaultSpreadsheetName: "Data",
        auth: undefined as unknown as string,
      });
      throw new Error("Expected VALIDATION_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
      expect((err as GenjutsuError).message).toContain("auth");
    }
  });

  test("throws VALIDATION_ERROR when appId is empty", async () => {
    try {
      await resolveWorkspace(baseConfig({ appId: "" }));
      throw new Error("Expected VALIDATION_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
      expect((err as GenjutsuError).message).toContain("appId");
    }
  });

  test("throws VALIDATION_ERROR when defaultSpreadsheetName is empty", async () => {
    try {
      await resolveWorkspace(baseConfig({ defaultSpreadsheetName: "" }));
      throw new Error("Expected VALIDATION_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
      expect((err as GenjutsuError).message).toContain("defaultSpreadsheetName");
    }
  });
});
