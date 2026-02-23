/**
 * Client factory for the genjutsu-db library.
 * Creates a schema-driven client with typed repositories.
 */

import type {
  SheetSchema,
  ClientConfig,
  GenjutsuClient,
  Repository,
  InferEntity,
  Migration,
  FindOptions,
  ReadOptions,
  WriteOptions,
} from "./types";
import type { TransportContext } from "./transport";
import {
  extractSpreadsheetId,
  getSheetValues,
  updateSheet,
  clearRange,
  batchClear,
  batchUpdate,
  getSpreadsheetMetadata,
  structuralBatchUpdate,
} from "./transport";
import { schemaError, permissionError, validationError } from "./errors";
import { validateForeignKeys, loadRelated } from "./relations";

const RESERVED_SHEET_NAMES = ["_genjutsu_migrations"];

export function createClient<
  S extends Record<string, SheetSchema<any>>,
>(config: ClientConfig<S>): GenjutsuClient<S> {
  // Validate config
  if (!config.spreadsheetId) {
    throw schemaError("spreadsheetId must be non-empty");
  }
  if (!config.auth && !config.apiKey) {
    throw schemaError("Either auth or apiKey must be provided");
  }

  const schemas = config.schemas;
  if (!schemas || Object.keys(schemas).length === 0) {
    throw schemaError("At least one schema must be registered");
  }

  // Validate schemas at creation time
  const sheetNames = new Set<string>();
  for (const [key, schema] of Object.entries(schemas)) {
    if (!schema.sheetName) {
      throw schemaError(`Schema "${key}" has empty sheetName`);
    }
    if (!schema.headers || schema.headers.length === 0) {
      throw schemaError(`Schema "${key}" has empty headers`);
    }
    if (sheetNames.has(schema.sheetName)) {
      throw schemaError(`Duplicate sheetName "${schema.sheetName}" in schemas`);
    }
    if (RESERVED_SHEET_NAMES.includes(schema.sheetName)) {
      throw schemaError(
        `Schema "${key}" uses reserved sheet name "${schema.sheetName}"`,
      );
    }
    sheetNames.add(schema.sheetName);

    // Validate FK target models exist in schemas
    if (schema.relations) {
      for (const rel of schema.relations) {
        if (!schemas[rel.targetModel]) {
          throw schemaError(
            `Schema "${key}" references model "${rel.targetModel}" which is not registered`,
          );
        }
      }
    }
  }

  const ctx: TransportContext = {
    auth: config.auth,
    apiKey: config.apiKey,
    spreadsheetId: config.spreadsheetId,
  };

  const isReadOnly = !config.auth;

  function assertWritable(): void {
    if (isReadOnly) {
      throw permissionError(
        "Write operations require auth. This client was created with apiKey only (read-only).",
      );
    }
  }

  // Write mutex: serializes all write operations
  let writeLock: Promise<void> = Promise.resolve();

  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = writeLock;
    let resolve: () => void;
    writeLock = new Promise<void>((r) => {
      resolve = r;
    });
    return prev.then(fn).finally(() => resolve!());
  }

  // Build a generic repository for a single schema
  function buildRepo<T>(schema: SheetSchema<T>, _allSchemas: S): Repository<T> {
    return {
      async create(record: Partial<T>, options?: WriteOptions): Promise<T> {
        assertWritable();
        return withWriteLock(async () => {
          // Apply defaults from field definitions
          const entity = applyDefaults(schema, record);

          // Validate
          if (schema.validate) schema.validate(entity);

          // Check duplicate PK
          if (schema.primaryKey) {
            const existing = await readAllRaw(schema);
            const pk = schema.primaryKey;
            const pkValue = (entity as Record<string, unknown>)[pk];
            const duplicate = existing.find(
              (e) => (e as Record<string, unknown>)[pk] === pkValue,
            );
            if (duplicate) {
              throw validationError(`Duplicate primary key: ${String(pkValue)}`, [
                { field: pk, message: "Duplicate primary key", value: pkValue },
              ]);
            }
          }

          // FK validation
          if (!options?.skipFkValidation) {
            await validateForeignKeys(entity, schema, schemas as Record<string, SheetSchema<any>>, ctx);
          }

          // Ensure headers exist before first append
          const rawRows = await getSheetValues(ctx, schema.writeRange, "FORMATTED_VALUE");
          if (rawRows.length === 0) {
            // Sheet is empty — write headers first
            await updateSheet(ctx, schema.writeRange, [schema.headers], false);
          }

          // Append single row
          const values = [schema.toRow(entity)];
          await updateSheet(ctx, schema.writeRange, values, true);
          return entity;
        });
      },

      async findById(id: string | number): Promise<T | null> {
        if (!schema.primaryKey) return null;
        const records = await readAllRaw(schema);
        const pk = schema.primaryKey;
        return (
          records.find((r) => (r as Record<string, unknown>)[pk] === id) ?? null
        );
      },

      async findMany(
        filter?: (item: T) => boolean,
        options?: FindOptions,
      ): Promise<T[]> {
        let records = await readAllRaw(schema);
        if (filter) records = records.filter(filter);
        if (options?.include) {
          records = await loadRelated(records, schema, options.include, schemas as Record<string, SheetSchema<any>>, ctx);
        }
        return records;
      },

      async update(
        id: string | number,
        changes: Partial<T>,
        options?: WriteOptions,
      ): Promise<T> {
        assertWritable();
        return withWriteLock(async () => {
          const records = await readAllRaw(schema);
          if (!schema.primaryKey) {
            throw validationError("Cannot update without a primary key", []);
          }
          const pk = schema.primaryKey;
          const index = records.findIndex(
            (r) => (r as Record<string, unknown>)[pk] === id,
          );
          if (index === -1) {
            throw validationError(`Record not found: ${String(id)}`, [
              { field: pk, message: "Record not found", value: id },
            ]);
          }

          const merged = { ...records[index], ...changes } as T;
          if (schema.validate) schema.validate(merged);

          // FK validation on changed fields
          if (!options?.skipFkValidation) {
            const changedFields = new Set(Object.keys(changes));
            await validateForeignKeys(merged, schema, schemas as Record<string, SheetSchema<any>>, ctx, changedFields);
          }

          records[index] = merged;

          // Rewrite all records
          const values: unknown[][] = [schema.headers];
          for (const r of records) values.push(schema.toRow(r));
          await clearRange(ctx, schema.clearRange);
          await updateSheet(ctx, schema.writeRange, values, false);
          return merged;
        });
      },

      async delete(id: string | number): Promise<void> {
        assertWritable();
        return withWriteLock(async () => {
          if (!schema.primaryKey) return;
          const records = await readAllRaw(schema);
          const pk = schema.primaryKey;
          const filtered = records.filter(
            (r) => (r as Record<string, unknown>)[pk] !== id,
          );

          const values: unknown[][] = [schema.headers];
          for (const r of filtered) values.push(schema.toRow(r));
          await clearRange(ctx, schema.clearRange);
          await updateSheet(ctx, schema.writeRange, values, false);
        });
      },

      async readAll(options?: ReadOptions): Promise<T[]> {
        let records = await readAllRaw(schema);
        if (options?.include) {
          records = await loadRelated(records, schema, options.include, schemas as Record<string, SheetSchema<any>>, ctx);
        }
        return records;
      },

      writeAll(records: T[]): Promise<void> {
        assertWritable();
        return withWriteLock(async () => {
          if (schema.validate) {
            for (const r of records) schema.validate(r);
          }
          const values: unknown[][] = [schema.headers];
          for (const r of records) values.push(schema.toRow(r));
          await clearRange(ctx, schema.clearRange);
          if (values.length > 0) {
            await updateSheet(ctx, schema.writeRange, values, false);
          }
        });
      },

      append(records: T[]): Promise<void> {
        assertWritable();
        if (schema.appendSupported === false) {
          return Promise.reject(
            schemaError(`Append not supported for "${schema.sheetName}"`),
          );
        }
        return withWriteLock(async () => {
          if (schema.validate) {
            for (const r of records) schema.validate(r);
          }
          // Ensure headers exist before first append
          const rawRows = await getSheetValues(ctx, schema.writeRange, "FORMATTED_VALUE");
          if (rawRows.length === 0) {
            await updateSheet(ctx, schema.writeRange, [schema.headers], false);
          }
          const values = records.map((r) => schema.toRow(r));
          await updateSheet(ctx, schema.writeRange, values, true);
        });
      },
    };
  }

  async function readAllRaw<T>(schema: SheetSchema<T>): Promise<T[]> {
    const rows = await getSheetValues(ctx, schema.readRange, "UNFORMATTED_VALUE");
    const results: T[] = [];
    for (let i = 0; i < rows.length; i++) {
      const entity = schema.parseRow(rows[i], i);
      if (entity != null) results.push(entity);
    }
    return results;
  }

  function applyDefaults<T>(schema: SheetSchema<T>, record: Partial<T>): T {
    if (!schema.fields) return record as T;
    const result = { ...record } as Record<string, unknown>;
    for (const field of schema.fields) {
      if (result[field.name] === undefined && field.defaultValue !== undefined) {
        result[field.name] = field.defaultValue;
      }
    }
    return result as T;
  }

  // Pre-build all repositories
  const repos: Record<string, Repository<unknown>> = {};
  for (const [key, schema] of Object.entries(schemas)) {
    repos[key] = buildRepo(schema, schemas);
  }

  return {
    repo<K extends keyof S & string>(key: K): Repository<InferEntity<S[K]>> {
      return repos[key] as Repository<InferEntity<S[K]>>;
    },

    batchSync(payload): Promise<void> {
      assertWritable();
      return withWriteLock(async () => {
        const clearRanges: string[] = [];
        const data: { range: string; values: unknown[][] }[] = [];

        for (const [key, schema] of Object.entries(schemas)) {
          clearRanges.push(schema.clearRange);
          const records = (payload as Record<string, unknown[]>)[key] ?? [];
          const values: unknown[][] = [schema.headers];
          for (const r of records) {
            values.push((schema as SheetSchema<any>).toRow(r));
          }
          data.push({ range: schema.writeRange, values });
        }

        await batchClear(ctx, clearRanges);
        await batchUpdate(ctx, data);
      });
    },

    async ensureSchema(): Promise<void> {
      const metadata = await getSpreadsheetMetadata(ctx);
      const titles = new Set(metadata.sheets.map((s) => s.title));
      const toAdd = Object.values(schemas)
        .map((s) => s.sheetName)
        .filter((t) => !titles.has(t));
      if (toAdd.length === 0) return;

      await structuralBatchUpdate(
        ctx,
        toAdd.map((title) => ({
          addSheet: { properties: { title } },
        })),
      );
    },

    async applyFormatting(): Promise<void> {
      const hasAnyFormatting = Object.values(schemas).some(
        (s) => (s.formatting && s.formatting.length > 0) || s.headerFormatting,
      );
      if (!hasAnyFormatting) return;

      const metadata = await getSpreadsheetMetadata(ctx);
      const sheetIdMap = new Map<string, number>();
      for (const s of metadata.sheets) {
        sheetIdMap.set(s.title, s.sheetId);
      }

      const requests: Record<string, unknown>[] = [];

      for (const schema of Object.values(schemas)) {
        const sheetId = sheetIdMap.get(schema.sheetName);
        if (sheetId == null) continue;

        // Header formatting
        if (schema.headerFormatting) {
          const hf = schema.headerFormatting;
          const cellFormat: Record<string, unknown> = {};
          const fields: string[] = [];

          if (hf.bold || hf.fontSize) {
            cellFormat.textFormat = {
              ...(hf.bold != null ? { bold: hf.bold } : {}),
              ...(hf.fontSize != null ? { fontSize: hf.fontSize } : {}),
            };
            fields.push("userEnteredFormat.textFormat");
          }
          if (hf.horizontalAlignment) {
            cellFormat.horizontalAlignment = hf.horizontalAlignment;
            fields.push("userEnteredFormat.horizontalAlignment");
          }

          if (fields.length > 0) {
            requests.push({
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: schema.headers.length,
                },
                cell: { userEnteredFormat: cellFormat },
                fields: fields.join(","),
              },
            });
          }
        }

        // Data formatting rules
        if (schema.formatting) {
          for (const rule of schema.formatting) {
            const cellFormat: Record<string, unknown> = {};
            const fields: string[] = [];

            if (rule.bold || rule.fontSize) {
              cellFormat.textFormat = {
                ...(rule.bold != null ? { bold: rule.bold } : {}),
                ...(rule.fontSize != null ? { fontSize: rule.fontSize } : {}),
              };
              fields.push("userEnteredFormat.textFormat");
            }
            if (rule.horizontalAlignment) {
              cellFormat.horizontalAlignment = rule.horizontalAlignment;
              fields.push("userEnteredFormat.horizontalAlignment");
            }
            if (rule.numberFormat) {
              cellFormat.numberFormat = rule.numberFormat;
              fields.push("userEnteredFormat.numberFormat");
            }

            if (fields.length > 0) {
              requests.push({
                repeatCell: {
                  range: {
                    sheetId,
                    startRowIndex: rule.startRow ?? 1,
                    endRowIndex: rule.endRow ?? 10000,
                    startColumnIndex: rule.startCol,
                    endColumnIndex: rule.endCol,
                  },
                  cell: { userEnteredFormat: cellFormat },
                  fields: fields.join(","),
                },
              });
            }
          }
        }
      }

      if (requests.length === 0) return;
      await structuralBatchUpdate(ctx, requests);
    },

    async migrate(_migrations: Migration[]): Promise<void> {
      assertWritable();
      // Stub — full implementation in src/migrations.ts (Phase 6)
      const { runMigrations } = await import("./migrations");
      await runMigrations(ctx, _migrations);
    },

    extractSpreadsheetId,

    raw: {
      readRange(
        range: string,
        valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE",
      ): Promise<unknown[][]> {
        return getSheetValues(ctx, range, valueRenderOption);
      },

      writeRange(range: string, values: unknown[][]): Promise<void> {
        assertWritable();
        return withWriteLock(() => updateSheet(ctx, range, values, false));
      },

      clearRange(range: string): Promise<void> {
        assertWritable();
        return withWriteLock(() => clearRange(ctx, range));
      },
    },
  } as GenjutsuClient<S>;
}
