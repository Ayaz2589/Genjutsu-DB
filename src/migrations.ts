/**
 * Migration runner for the genjutsu-db library.
 * Versioned up() migrations with tracking in _genjutsu_migrations sheet.
 */

import type { TransportContext } from "./transport";
import type { Migration, MigrationContext } from "./types";
import {
  getSpreadsheetMetadata,
  structuralBatchUpdate,
  getSheetValues,
  updateSheet,
} from "./transport";
import { schemaError, migrationError } from "./errors";

const MIGRATIONS_SHEET = "_genjutsu_migrations";
const MIGRATIONS_RANGE = `${MIGRATIONS_SHEET}!A2:C`;

/**
 * Run pending migrations, tracking applied ones in _genjutsu_migrations.
 */
export async function runMigrations(
  ctx: TransportContext,
  migrations: Migration[],
): Promise<void> {
  // Validate: no duplicate version numbers
  const versions = new Set<number>();
  for (const m of migrations) {
    if (versions.has(m.version)) {
      throw schemaError(
        `Migrations have duplicate version number: ${m.version}`,
      );
    }
    versions.add(m.version);
  }

  // Sort migrations by version ascending
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  // Ensure _genjutsu_migrations sheet exists
  const metadata = await getSpreadsheetMetadata(ctx);
  const sheetIdMap = new Map<string, number>();
  for (const s of metadata.sheets) {
    sheetIdMap.set(s.title, s.sheetId);
  }

  if (!sheetIdMap.has(MIGRATIONS_SHEET)) {
    await structuralBatchUpdate(ctx, [
      { addSheet: { properties: { title: MIGRATIONS_SHEET } } },
    ]);
    // Refresh metadata after creating the sheet
    const refreshed = await getSpreadsheetMetadata(ctx);
    for (const s of refreshed.sheets) {
      sheetIdMap.set(s.title, s.sheetId);
    }
  }

  // Read applied migration versions
  const rows = await getSheetValues(ctx, MIGRATIONS_RANGE, "UNFORMATTED_VALUE");
  const appliedVersions = new Set<number>();
  for (const row of rows) {
    const ver = Number(row[0]);
    if (!Number.isNaN(ver)) appliedVersions.add(ver);
  }

  // Filter to pending migrations
  const pending = sorted.filter((m) => !appliedVersions.has(m.version));
  if (pending.length === 0) return;

  // Create migration context
  const mCtx = createMigrationContext(ctx, sheetIdMap);

  // Execute each pending migration
  for (const m of pending) {
    try {
      await m.up(mCtx);
    } catch (err) {
      throw migrationError(
        `Migration ${m.version} (${m.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
        m.version,
        m.name,
        err,
      );
    }

    // Record the successful migration
    const timestamp = new Date().toISOString();
    await updateSheet(
      ctx,
      `${MIGRATIONS_SHEET}!A1:C`,
      [[m.version, m.name, timestamp]],
      true,
    );
  }
}

/**
 * Create a MigrationContext that wraps the transport context.
 */
function createMigrationContext(
  ctx: TransportContext,
  sheetIdMap: Map<string, number>,
): MigrationContext {
  function resolveSheetId(sheetName: string): number {
    const id = sheetIdMap.get(sheetName);
    if (id === undefined) {
      throw schemaError(`Sheet "${sheetName}" not found in spreadsheet`);
    }
    return id;
  }

  return {
    async createSheet(name: string): Promise<void> {
      await structuralBatchUpdate(ctx, [
        { addSheet: { properties: { title: name } } },
      ]);
    },

    async addColumn(
      sheet: string,
      column: string,
      afterIndex?: number,
    ): Promise<void> {
      const sheetId = resolveSheetId(sheet);
      const colIndex = afterIndex ?? 0;
      await structuralBatchUpdate(ctx, [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: colIndex,
              endIndex: colIndex + 1,
            },
            inheritFromBefore: false,
          },
        },
        {
          updateCells: {
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: column },
                  },
                ],
              },
            ],
            start: { sheetId, rowIndex: 0, columnIndex: colIndex },
            fields: "userEnteredValue",
          },
        },
      ]);
    },

    async removeColumn(sheet: string, columnIndex: number): Promise<void> {
      const sheetId = resolveSheetId(sheet);
      await structuralBatchUpdate(ctx, [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: "COLUMNS",
              startIndex: columnIndex,
              endIndex: columnIndex + 1,
            },
          },
        },
      ]);
    },

    async renameColumn(
      sheet: string,
      columnIndex: number,
      newName: string,
    ): Promise<void> {
      const sheetId = resolveSheetId(sheet);
      await structuralBatchUpdate(ctx, [
        {
          updateCells: {
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: newName },
                  },
                ],
              },
            ],
            start: { sheetId, rowIndex: 0, columnIndex },
            fields: "userEnteredValue",
          },
        },
      ]);
    },

    async renameSheet(oldName: string, newName: string): Promise<void> {
      const sheetId = resolveSheetId(oldName);
      await structuralBatchUpdate(ctx, [
        {
          updateSheetProperties: {
            properties: { sheetId, title: newName },
            fields: "title",
          },
        },
      ]);
    },
  };
}
