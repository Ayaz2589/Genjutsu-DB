/**
 * Generic types for the genjutsu-db library.
 * Schema-driven API: SheetSchema<T>, Repository<T>, GenjutsuClient<S>, and supporting types.
 */

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export interface FormattingRule {
  startCol: number;
  endCol: number;
  startRow?: number;
  endRow?: number;
  bold?: boolean;
  fontSize?: number;
  horizontalAlignment?: "LEFT" | "CENTER" | "RIGHT";
  numberFormat?: { type: string; pattern?: string };
}

export interface HeaderFormat {
  bold?: boolean;
  fontSize?: number;
  horizontalAlignment?: "LEFT" | "CENTER" | "RIGHT";
}

// ---------------------------------------------------------------------------
// Field Definitions
// ---------------------------------------------------------------------------

export interface FieldDefinition {
  name: string;
  type: "string" | "number" | "date" | "boolean";
  isPrimaryKey?: boolean;
  isOptional?: boolean;
  defaultValue?: unknown;
  references?: { model: string; field: string };
}

export interface RelationDefinition {
  sourceField: string;
  targetModel: string;
  targetField: string;
  type: "many-to-one";
}

// ---------------------------------------------------------------------------
// Schema Definition
// ---------------------------------------------------------------------------

export interface SheetSchema<T> {
  sheetName: string;
  headers: string[];
  readRange: string;
  writeRange: string;
  clearRange: string;
  parseRow(row: unknown[], rowIndex: number): T | null;
  toRow(entity: T): unknown[];
  validate?: (entity: T) => void;
  appendSupported?: boolean;
  formatting?: FormattingRule[];
  headerFormatting?: HeaderFormat;
  primaryKey?: string;
  fields?: FieldDefinition[];
  relations?: RelationDefinition[];
}

export type InferEntity<S> = S extends SheetSchema<infer T> ? T : never;

// ---------------------------------------------------------------------------
// Repository Options
// ---------------------------------------------------------------------------

export interface FindOptions {
  include?: Record<string, true>;
}

export interface ReadOptions {
  include?: Record<string, true>;
}

export interface WriteOptions {
  skipFkValidation?: boolean;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface Repository<T> {
  create(record: Partial<T>, options?: WriteOptions): Promise<T>;
  findById(id: string | number): Promise<T | null>;
  findMany(filter?: (item: T) => boolean, options?: FindOptions): Promise<T[]>;
  update(id: string | number, changes: Partial<T>, options?: WriteOptions): Promise<T>;
  delete(id: string | number): Promise<void>;
  readAll(options?: ReadOptions): Promise<T[]>;
  writeAll(records: T[]): Promise<void>;
  append(records: T[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Client Configuration
// ---------------------------------------------------------------------------

export interface ClientConfig<S extends Record<string, SheetSchema<any>>> {
  spreadsheetId: string;
  auth?: string | (() => Promise<string>);
  apiKey?: string;
  schemas: S;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface RawRangeApi {
  readRange(
    range: string,
    valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE",
  ): Promise<unknown[][]>;
  writeRange(range: string, values: unknown[][]): Promise<void>;
  clearRange(range: string): Promise<void>;
}

export interface GenjutsuClient<S extends Record<string, SheetSchema<any>>> {
  repo<K extends keyof S & string>(key: K): Repository<InferEntity<S[K]>>;
  batchSync(payload: Partial<{ [K in keyof S]: InferEntity<S[K]>[] }>): Promise<void>;
  ensureSchema(): Promise<void>;
  applyFormatting(): Promise<void>;
  migrate(migrations: Migration[]): Promise<void>;
  extractSpreadsheetId(urlOrId: string): string | null;
  raw: RawRangeApi;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

export interface Migration {
  version: number;
  name: string;
  up: (ctx: MigrationContext) => Promise<void>;
}

export interface MigrationContext {
  createSheet(name: string): Promise<void>;
  addColumn(sheet: string, column: string, afterIndex?: number): Promise<void>;
  removeColumn(sheet: string, columnIndex: number): Promise<void>;
  renameColumn(sheet: string, columnIndex: number, newName: string): Promise<void>;
  renameSheet(oldName: string, newName: string): Promise<void>;
}
