/**
 * Model definition API for the genjutsu-db library.
 * Provides field builders and defineModel() for TypeScript-first schema definition.
 */

import type { SheetSchema, FieldDefinition, RelationDefinition } from "./types";
import { schemaError, validationError } from "./errors";

// ---------------------------------------------------------------------------
// FieldDef — chainable field builder
// ---------------------------------------------------------------------------

export interface FieldDef<T = unknown> {
  readonly _type: "string" | "number" | "date" | "boolean";
  readonly _isPrimaryKey: boolean;
  readonly _isOptional: boolean;
  readonly _defaultValue: T | undefined;
  readonly _references: { model: string; field: string } | undefined;
  primaryKey(): FieldDef<T>;
  optional(): FieldDef<T | null>;
  default(value: T): FieldDef<T>;
  references(model: string, field: string): FieldDef<T>;
}

function createFieldDef<T>(
  type: "string" | "number" | "date" | "boolean",
  isPrimaryKey = false,
  isOptional = false,
  defaultValue: T | undefined = undefined,
  references: { model: string; field: string } | undefined = undefined,
): FieldDef<T> {
  return {
    _type: type,
    _isPrimaryKey: isPrimaryKey,
    _isOptional: isOptional,
    _defaultValue: defaultValue,
    _references: references,
    primaryKey() {
      return createFieldDef<T>(type, true, isOptional, defaultValue, references);
    },
    optional() {
      return createFieldDef<T | null>(type, isPrimaryKey, true, defaultValue as (T | null | undefined), references);
    },
    default(value: T) {
      return createFieldDef<T>(type, isPrimaryKey, isOptional, value, references);
    },
    references(model: string, field: string) {
      return createFieldDef<T>(type, isPrimaryKey, isOptional, defaultValue, { model, field });
    },
  };
}

export const field = {
  string: () => createFieldDef<string>("string"),
  number: () => createFieldDef<number>("number"),
  date: () => createFieldDef<string>("date"),
  boolean: () => createFieldDef<boolean>("boolean"),
};

// ---------------------------------------------------------------------------
// defineModel — generates SheetSchema from field declarations
// ---------------------------------------------------------------------------

function columnLetter(index: number): string {
  // 0-based index to A-Z (only supports up to 26 columns for now)
  return String.fromCharCode(65 + index);
}

export function defineModel<F extends Record<string, FieldDef<any>>>(
  sheetName: string,
  fields: F,
): SheetSchema<any> {
  const entries = Object.entries(fields);

  // Validate
  if (entries.length === 0) {
    throw schemaError("defineModel requires at least one field");
  }

  const primaryKeys = entries.filter(([, f]) => f._isPrimaryKey);
  if (primaryKeys.length === 0) {
    throw schemaError("defineModel requires exactly one field marked as primaryKey");
  }
  if (primaryKeys.length > 1) {
    throw schemaError(
      `defineModel requires exactly one primaryKey, found ${primaryKeys.length}: ${primaryKeys.map(([n]) => n).join(", ")}`,
    );
  }

  const headers = entries.map(([name]) => name);
  const lastCol = columnLetter(headers.length - 1);
  const primaryKeyName = primaryKeys[0][0];

  // Build FieldDefinition array
  const fieldDefs: FieldDefinition[] = entries.map(([name, f]) => ({
    name,
    type: f._type,
    isPrimaryKey: f._isPrimaryKey || undefined,
    isOptional: f._isOptional || undefined,
    defaultValue: f._defaultValue,
    references: f._references,
  }));

  // Build RelationDefinition array
  const relations: RelationDefinition[] = entries
    .filter(([, f]) => f._references)
    .map(([name, f]) => ({
      sourceField: name,
      targetModel: f._references!.model,
      targetField: f._references!.field,
      type: "many-to-one" as const,
    }));

  // Parse a single cell value based on field type
  function parseCell(
    value: unknown,
    fieldEntry: [string, FieldDef<any>],
  ): unknown {
    const [, f] = fieldEntry;
    const isEmpty = value === undefined || value === null || value === "";

    // Use default if available and cell is empty
    if (isEmpty && f._defaultValue !== undefined) {
      return f._defaultValue;
    }

    switch (f._type) {
      case "string":
      case "date":
        return isEmpty ? (f._isOptional ? null : "") : String(value);
      case "number":
        return isEmpty ? (f._isOptional ? null : 0) : Number(value);
      case "boolean":
        if (value === true || value === "TRUE" || value === "true") return true;
        return false;
    }
  }

  const schema: SheetSchema<any> = {
    sheetName,
    headers,
    readRange: `${sheetName}!A2:${lastCol}`,
    writeRange: `${sheetName}!A1:${lastCol}`,
    clearRange: `${sheetName}!A2:${lastCol}`,
    primaryKey: primaryKeyName,
    fields: fieldDefs,
    relations: relations.length > 0 ? relations : undefined,

    parseRow(row: unknown[], _rowIndex: number): any | null {
      // Skip rows where first cell is empty
      const firstCell = row[0];
      if (firstCell === undefined || firstCell === null || String(firstCell).trim() === "") {
        return null;
      }

      const entity: Record<string, unknown> = {};
      for (let i = 0; i < entries.length; i++) {
        const value = i < row.length ? row[i] : undefined;
        entity[entries[i][0]] = parseCell(value, entries[i]);
      }
      return entity;
    },

    toRow(entity: any): unknown[] {
      return headers.map((h) => entity[h]);
    },

    validate(entity: any): void {
      const issues: { field: string; message: string; value?: unknown }[] = [];
      for (const [name, f] of entries) {
        const value = entity[name];
        if (!f._isOptional && (value === null || value === undefined)) {
          issues.push({
            field: name,
            message: `Required field "${name}" is missing or null`,
            value,
          });
        }
      }
      if (issues.length > 0) {
        throw validationError(
          `Validation failed: ${issues.map((i) => i.message).join(", ")}`,
          issues,
        );
      }
    },
  };

  return schema;
}
