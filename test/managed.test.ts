/**
 * Tests for the managed client factory (src/managed.ts).
 */

import { describe, test, expect, afterEach, mock } from "bun:test";
import { GenjutsuError } from "../src/errors";
import { createManagedClient } from "../src/managed";
import { defineModel, field } from "../src/model";

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

/**
 * Build a sequential mock that returns workspace responses first,
 * then handles subsequent client calls.
 */
function buildSequentialMock(responses: Array<unknown>) {
  let callIndex = 0;
  return mock(() => {
    const response = responses[callIndex] ?? {};
    callIndex++;
    return Promise.resolve(jsonResponse(response));
  });
}

const TestModel = defineModel("Items", {
  id: field.string().primaryKey(),
  name: field.string(),
});

// ---------------------------------------------------------------------------
// createManagedClient
// ---------------------------------------------------------------------------

describe("createManagedClient", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns client and workspace on first-time setup", async () => {
    const mockFetch = buildSequentialMock([
      { files: [] }, // findFolder: none
      { id: "folder-1", name: "Test" }, // createFolder
      { files: [] }, // listSheets: empty
      { id: "sheet-1", name: "Test Data" }, // createSheet
    ]);
    globalThis.fetch = mockFetch;

    const { client, workspace } = await createManagedClient({
      appId: "test-app",
      defaultSpreadsheetName: "Test Data",
      auth: "test-token",
      schemas: { items: TestModel },
    });

    expect(workspace.folderId).toBe("folder-1");
    expect(workspace.spreadsheetId).toBe("sheet-1");
    expect(workspace.created).toBe(true);

    // Client should have a working repo method
    expect(typeof client.repo).toBe("function");
    const repo = client.repo("items");
    expect(typeof repo.create).toBe("function");
    expect(typeof repo.findById).toBe("function");
    expect(typeof repo.findMany).toBe("function");
    expect(typeof repo.update).toBe("function");
    expect(typeof repo.delete).toBe("function");
  });

  test("returns client and workspace for returning user", async () => {
    const mockFetch = buildSequentialMock([
      { files: [{ id: "folder-1", name: "App" }] }, // findFolder
      { files: [{ id: "sheet-1", name: "Data" }] }, // listSheets
    ]);
    globalThis.fetch = mockFetch;

    const { client, workspace } = await createManagedClient({
      appId: "my-app",
      defaultSpreadsheetName: "Data",
      auth: "token",
      schemas: { items: TestModel },
    });

    expect(workspace.created).toBe(false);
    expect(workspace.spreadsheetId).toBe("sheet-1");
    expect(client.raw).toBeDefined();
    expect(typeof client.raw.readRange).toBe("function");
  });

  test("throws VALIDATION_ERROR when auth is missing", async () => {
    try {
      await createManagedClient({
        appId: "app",
        defaultSpreadsheetName: "Data",
        auth: undefined as unknown as string,
        schemas: { items: TestModel },
      });
      throw new Error("Expected VALIDATION_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
    }
  });

  test("throws VALIDATION_ERROR when appId is empty", async () => {
    try {
      await createManagedClient({
        appId: "",
        defaultSpreadsheetName: "Data",
        auth: "token",
        schemas: { items: TestModel },
      });
      throw new Error("Expected VALIDATION_ERROR");
    } catch (err) {
      expect(err).toBeInstanceOf(GenjutsuError);
      expect((err as GenjutsuError).kind).toBe("VALIDATION_ERROR");
    }
  });
});
