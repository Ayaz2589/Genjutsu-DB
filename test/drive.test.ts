/**
 * Tests for the Google Drive v3 transport module (src/drive.ts).
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { GenjutsuError } from "../src/errors";
import {
  findAppFolder,
  createAppFolder,
  listSpreadsheetsInFolder,
  createSpreadsheetInFolder,
  DRIVE_API,
} from "../src/drive";
import type { DriveContext } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function ctx(overrides: Partial<DriveContext> = {}): DriveContext {
  return { auth: "test-token", ...overrides };
}

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
// findAppFolder
// ---------------------------------------------------------------------------

describe("findAppFolder", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns the folder when found", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({
          files: [
            { id: "folder-123", name: "Budget", modifiedTime: "2026-01-01" },
          ],
        }),
      ),
    );

    const result = await findAppFolder(ctx(), "budget");
    expect(result).toEqual({ id: "folder-123", name: "Budget" });
  });

  test("returns null when no folders match", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse({ files: [] })),
    );

    const result = await findAppFolder(ctx(), "budget");
    expect(result).toBeNull();
  });

  test("returns null when files key is missing", async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse({})));

    const result = await findAppFolder(ctx(), "budget");
    expect(result).toBeNull();
  });

  test("picks the first folder (most recently modified) when multiple exist", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({
          files: [
            { id: "newest", name: "Budget", modifiedTime: "2026-03-01" },
            { id: "oldest", name: "Budget", modifiedTime: "2026-01-01" },
          ],
        }),
      ),
    );

    const result = await findAppFolder(ctx(), "budget");
    expect(result).toEqual({ id: "newest", name: "Budget" });
  });

  test("queries with correct appProperties filter", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ files: [] })),
    );
    globalThis.fetch = mockFetch;

    await findAppFolder(ctx(), "my-app");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("appProperties");
    expect(url).toContain("genjutsuApp");
    expect(url).toContain("my-app");
    expect(url).toContain("application%2Fvnd.google-apps.folder");
    expect(url).toContain("trashed%3Dfalse");
    expect(url).toContain("supportsAllDrives=true");
    expect(url).toContain("includeItemsFromAllDrives=true");
  });

  test("sends Authorization header", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ files: [] })),
    );
    globalThis.fetch = mockFetch;

    await findAppFolder(ctx({ auth: "my-token" }), "app");

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-token");
  });

  test("throws PERMISSION_ERROR on 403", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Forbidden", 403)),
    );

    try {
      await findAppFolder(ctx(), "app");
      throw new Error("Expected PERMISSION_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });

  test("throws RATE_LIMIT on 429", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        textResponse("Too Many Requests", 429, { "Retry-After": "5" }),
      ),
    );

    try {
      await findAppFolder(ctx(), "app");
      throw new Error("Expected RATE_LIMIT");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      const gErr = err as GenjutsuError;
      expect(gErr.kind).toBe("RATE_LIMIT");
      expect(gErr.retryAfterMs).toBe(5000);
    }
  });

  test("retries on 401 with async auth", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(textResponse("Unauthorized", 401));
      }
      return Promise.resolve(
        jsonResponse({ files: [{ id: "f1", name: "App" }] }),
      );
    });

    const result = await findAppFolder(
      ctx({ auth: async () => "fresh-token" }),
      "app",
    );
    expect(result).toEqual({ id: "f1", name: "App" });
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// createAppFolder
// ---------------------------------------------------------------------------

describe("createAppFolder", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("creates a folder and returns id and name", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse({ id: "new-folder", name: "Budget" })),
    );

    const result = await createAppFolder(ctx(), "budget", "Budget");
    expect(result).toEqual({ id: "new-folder", name: "Budget" });
  });

  test("sends correct request body with appProperties", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ id: "f1", name: "App" })),
    );
    globalThis.fetch = mockFetch;

    await createAppFolder(ctx(), "my-app", "My App");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(url).toContain("supportsAllDrives=true");

    const body = JSON.parse(init.body as string);
    expect(body.name).toBe("My App");
    expect(body.mimeType).toBe("application/vnd.google-apps.folder");
    expect(body.appProperties).toEqual({
      genjutsuApp: "my-app",
      genjutsuType: "appFolder",
    });
  });

  test("throws DRIVE_ERROR when response is missing id", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse({ name: "Budget" })),
    );

    try {
      await createAppFolder(ctx(), "budget", "Budget");
      throw new Error("Expected DRIVE_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("DRIVE_ERROR");
    }
  });

  test("throws AUTH_ERROR on 401 with static auth", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Unauthorized", 401)),
    );

    try {
      await createAppFolder(ctx(), "app", "App");
      throw new Error("Expected AUTH_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("AUTH_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// listSpreadsheetsInFolder
// ---------------------------------------------------------------------------

describe("listSpreadsheetsInFolder", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns spreadsheets found in folder", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({
          files: [
            { id: "sheet-1", name: "Budget Data", modifiedTime: "2026-03-01" },
            { id: "sheet-2", name: "Archive", modifiedTime: "2026-01-01" },
          ],
        }),
      ),
    );

    const result = await listSpreadsheetsInFolder(ctx(), "folder-123");
    expect(result).toEqual([
      { id: "sheet-1", name: "Budget Data" },
      { id: "sheet-2", name: "Archive" },
    ]);
  });

  test("returns empty array when folder has no spreadsheets", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse({ files: [] })),
    );

    const result = await listSpreadsheetsInFolder(ctx(), "folder-123");
    expect(result).toEqual([]);
  });

  test("returns empty array when files key is missing", async () => {
    globalThis.fetch = mock(() => Promise.resolve(jsonResponse({})));

    const result = await listSpreadsheetsInFolder(ctx(), "folder-123");
    expect(result).toEqual([]);
  });

  test("filters out files with missing id or name", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        jsonResponse({
          files: [
            { id: "valid", name: "Sheet" },
            { id: null, name: "No ID" },
            { id: "no-name", name: null },
          ],
        }),
      ),
    );

    const result = await listSpreadsheetsInFolder(ctx(), "folder-123");
    expect(result).toEqual([{ id: "valid", name: "Sheet" }]);
  });

  test("queries with correct folder parent filter", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ files: [] })),
    );
    globalThis.fetch = mockFetch;

    await listSpreadsheetsInFolder(ctx(), "parent-folder-id");

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("parent-folder-id");
    expect(url).toContain("application%2Fvnd.google-apps.spreadsheet");
    expect(url).toContain("trashed%3Dfalse");
  });

  test("throws PERMISSION_ERROR on 403", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Forbidden", 403)),
    );

    try {
      await listSpreadsheetsInFolder(ctx(), "folder-123");
      throw new Error("Expected PERMISSION_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("PERMISSION_ERROR");
    }
  });
});

// ---------------------------------------------------------------------------
// createSpreadsheetInFolder
// ---------------------------------------------------------------------------

describe("createSpreadsheetInFolder", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("creates spreadsheet in folder and returns id and name", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse({ id: "sheet-abc", name: "Budget Data" })),
    );

    const result = await createSpreadsheetInFolder(
      ctx(),
      "folder-123",
      "Budget Data",
      "budget",
    );
    expect(result).toEqual({ id: "sheet-abc", name: "Budget Data" });
  });

  test("sends correct request body with parents and appProperties", async () => {
    const mockFetch = mock(() =>
      Promise.resolve(jsonResponse({ id: "s1", name: "Sheet" })),
    );
    globalThis.fetch = mockFetch;

    await createSpreadsheetInFolder(ctx(), "folder-xyz", "My Sheet", "my-app");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(url).toContain("supportsAllDrives=true");

    const body = JSON.parse(init.body as string);
    expect(body.name).toBe("My Sheet");
    expect(body.mimeType).toBe("application/vnd.google-apps.spreadsheet");
    expect(body.parents).toEqual(["folder-xyz"]);
    expect(body.appProperties).toEqual({
      genjutsuApp: "my-app",
      genjutsuType: "spreadsheet",
    });
  });

  test("throws DRIVE_ERROR when response is missing id", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(jsonResponse({ name: "Sheet" })),
    );

    try {
      await createSpreadsheetInFolder(ctx(), "f1", "Sheet", "app");
      throw new Error("Expected DRIVE_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("DRIVE_ERROR");
    }
  });

  test("throws AUTH_ERROR on 401 with static auth", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(textResponse("Unauthorized", 401)),
    );

    try {
      await createSpreadsheetInFolder(ctx(), "f1", "Sheet", "app");
      throw new Error("Expected AUTH_ERROR");
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
      await createSpreadsheetInFolder(ctx(), "f1", "Sheet", "app");
      throw new Error("Expected RATE_LIMIT");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("RATE_LIMIT");
    }
  });
});
