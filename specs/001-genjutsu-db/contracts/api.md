# API Contracts: genjutsu-db

**Feature Branch**: `001-genjutsu-db`
**Date**: 2026-02-19

## Overview

genjutsu-db is a TypeScript library (not a web service), so contracts describe the **public TypeScript API surface** — exported functions, types, and their signatures. This replaces a traditional REST/GraphQL contract document.

---

## 1. Client Factory

### `createClient(config)`

Creates a new genjutsu-db client connected to a Google Spreadsheet.

**Signature:**
```typescript
function createClient<S extends Record<string, SheetSchema<any>>>(
  config: ClientConfig<S>
): GenjutsuClient<S>
```

**Input — `ClientConfig<S>`:**
```typescript
interface ClientConfig<S extends Record<string, SheetSchema<any>>> {
  spreadsheetId: string;          // Google Spreadsheet ID or full URL
  auth?: string | (() => Promise<string>);  // OAuth token or async provider
  apiKey?: string;                // API key for public sheet reads
  schemas: S;                     // Registered model schemas
}
```

**Output — `GenjutsuClient<S>`:**
```typescript
interface GenjutsuClient<S extends Record<string, SheetSchema<any>>> {
  repo<K extends keyof S & string>(key: K): Repository<InferEntity<S[K]>>;
  batchSync(payload: Partial<{ [K in keyof S]: InferEntity<S[K]>[] }>): Promise<void>;
  ensureSchema(): Promise<void>;
  applyFormatting(): Promise<void>;
  migrate(migrations: Migration[]): Promise<void>;
  extractSpreadsheetId(urlOrId: string): string | null;
}
```

**Errors:**
- `SCHEMA_ERROR` — empty spreadsheetId, no schemas, duplicate sheetNames, reserved name used, empty headers
- `AUTH_ERROR` — neither auth nor apiKey provided

**Example:**
```typescript
import { createClient, defineModel, field } from 'genjutsu-db';

const Contact = defineModel('Contacts', {
  id: field.string().primaryKey(),
  name: field.string(),
  email: field.string().optional(),
});

const db = createClient({
  spreadsheetId: '1abc...xyz',
  auth: () => getGoogleToken(),
  schemas: { contacts: Contact },
});
```

---

## 2. defineModel

### `defineModel(sheetName, fields)`

Creates a typed SheetSchema from declarative field definitions.

**Signature:**
```typescript
function defineModel<F extends Record<string, FieldDef<any>>>(
  sheetName: string,
  fields: F
): SheetSchema<InferModelType<F>>
```

**Input:**
- `sheetName` — name of the Google Sheet tab
- `fields` — object mapping field names to FieldDef instances

**Output:**
A `SheetSchema<T>` with auto-generated `headers`, `readRange`, `writeRange`, `clearRange`, `parseRow`, `toRow`, `validate`, and `primaryKey`.

**Errors:**
- `SCHEMA_ERROR` — zero fields, no primary key, multiple primary keys, invalid default value type

---

## 3. Field Builder

### `field.string()`, `field.number()`, `field.date()`, `field.boolean()`

Creates typed field definitions with chainable options.

**Signatures:**
```typescript
const field: {
  string():  FieldDef<string>;
  number():  FieldDef<number>;
  date():    FieldDef<string>;    // ISO date string
  boolean(): FieldDef<boolean>;
}

interface FieldDef<T> {
  primaryKey(): FieldDef<T>;
  optional(): FieldDef<T | null>;
  default(value: T): FieldDef<T>;
  references(model: string, field: string): FieldDef<T>;
}
```

**Example:**
```typescript
const Task = defineModel('Tasks', {
  id:          field.string().primaryKey(),
  title:       field.string(),
  description: field.string().optional(),
  priority:    field.number().default(0),
  completed:   field.boolean().default(false),
  assigneeId:  field.string().references('contacts', 'id'),
  dueDate:     field.date().optional(),
});
```

---

## 4. Repository CRUD Operations

All CRUD operations are accessed via `db.repo('modelName')`.

### `create(record)`

**Signature:**
```typescript
create(record: CreateInput<T>, options?: WriteOptions): Promise<T>
```

**Behavior:**
1. Apply default values for missing optional fields
2. Validate against field definitions
3. If FK references exist and `skipFkValidation` is not set: validate referenced records exist
4. Check for duplicate primary key (read existing records)
5. Append single row to sheet

**Errors:**
- `VALIDATION_ERROR` — field validation failed, duplicate PK, invalid FK reference
- `AUTH_ERROR`, `PERMISSION_ERROR`, `RATE_LIMIT`, `NETWORK_ERROR`, `API_ERROR` — transport errors

---

### `findById(id)`

**Signature:**
```typescript
findById(id: string | number): Promise<T | null>
```

**Behavior:**
1. Read all rows from sheet
2. Parse each row via schema
3. Return first record matching primary key, or null

**Errors:**
- `AUTH_ERROR`, `PERMISSION_ERROR`, `RATE_LIMIT`, `NETWORK_ERROR`, `API_ERROR` — transport errors

---

### `findMany(filter?, options?)`

**Signature:**
```typescript
findMany(filter?: (item: T) => boolean, options?: FindOptions): Promise<T[]>
```

**Behavior:**
1. Read all rows from sheet
2. Parse each row via schema
3. Apply filter function in-memory (if provided)
4. If `options.include` specified: batch-read related sheets, attach related records

**FindOptions:**
```typescript
interface FindOptions {
  include?: Record<string, true>;  // e.g., { tasks: true }
}
```

**Errors:**
- `AUTH_ERROR`, `PERMISSION_ERROR`, `RATE_LIMIT`, `NETWORK_ERROR`, `API_ERROR` — transport errors

---

### `update(id, changes)`

**Signature:**
```typescript
update(id: string | number, changes: Partial<T>, options?: WriteOptions): Promise<T>
```

**Behavior:**
1. Read all rows from sheet
2. Find record by primary key (throw VALIDATION_ERROR if not found)
3. Merge changes into existing record
4. Validate merged result
5. If FK references exist on changed fields: validate referenced records exist
6. Write all rows back to sheet (clear + write)

**Errors:**
- `VALIDATION_ERROR` — record not found, validation failed, invalid FK reference
- `AUTH_ERROR`, `PERMISSION_ERROR`, `RATE_LIMIT`, `NETWORK_ERROR`, `API_ERROR` — transport errors

---

### `delete(id)`

**Signature:**
```typescript
delete(id: string | number): Promise<void>
```

**Behavior:**
1. Read all rows from sheet
2. Filter out record matching primary key
3. Write remaining rows back to sheet (clear + write)
4. If no record matched, operation is a no-op (no error)

**Errors:**
- `AUTH_ERROR`, `PERMISSION_ERROR`, `RATE_LIMIT`, `NETWORK_ERROR`, `API_ERROR` — transport errors

---

### `readAll(options?)`

**Signature:**
```typescript
readAll(options?: ReadOptions): Promise<T[]>
```

**Behavior:**
1. Read all rows from sheet
2. Parse each row via schema
3. If `options.include` specified: batch-read related sheets, attach related records

---

### `writeAll(records)`

**Signature:**
```typescript
writeAll(records: T[]): Promise<void>
```

**Behavior:**
1. Clear data range (preserving headers)
2. Write headers + all records as rows

---

### `append(records)`

**Signature:**
```typescript
append(records: T[]): Promise<void>
```

**Behavior:**
1. Append records as new rows (no clear)

---

## 5. Batch Operations

### `batchSync(payload)`

**Signature:**
```typescript
batchSync(payload: Partial<{ [K in keyof S]: InferEntity<S[K]>[] }>): Promise<void>
```

**Behavior:**
1. Build clear ranges for all schemas
2. Build data arrays (headers + rows) for all schemas
3. `POST values:batchClear` — clear all ranges in one call
4. `POST values:batchUpdate` — write all data in one call

**Errors:**
- `API_ERROR` — if batchClear or batchUpdate fails

---

### `ensureSchema()`

**Signature:**
```typescript
ensureSchema(): Promise<void>
```

**Behavior:**
1. Fetch spreadsheet metadata (sheet titles)
2. Compare against registered schemas
3. Create missing sheets via `batchUpdate` with `addSheet` requests

---

### `applyFormatting()`

**Signature:**
```typescript
applyFormatting(): Promise<void>
```

**Behavior:**
1. If no formatting rules registered: no-op
2. Fetch metadata for sheet IDs
3. Build `repeatCell` requests from formatting rules
4. Send via `batchUpdate`

---

## 6. Migration API

### `migrate(migrations)`

**Signature:**
```typescript
migrate(migrations: Migration[]): Promise<void>
```

**Input — `Migration`:**
```typescript
interface Migration {
  version: number;
  name: string;
  up: (ctx: MigrationContext) => Promise<void>;
}
```

**MigrationContext:**
```typescript
interface MigrationContext {
  createSheet(name: string): Promise<void>;
  addColumn(sheet: string, column: string, afterIndex?: number): Promise<void>;
  removeColumn(sheet: string, columnIndex: number): Promise<void>;
  renameColumn(sheet: string, columnIndex: number, newName: string): Promise<void>;
  renameSheet(oldName: string, newName: string): Promise<void>;
}
```

**Behavior:**
1. Ensure `_genjutsu_migrations` sheet tab exists
2. Read applied migration versions
3. Filter to pending migrations (not yet applied)
4. Sort by version ascending
5. For each pending migration:
   a. Call `migration.up(ctx)`
   b. On success: append record to `_genjutsu_migrations` (version, name, timestamp)
   c. On failure: wrap error in `MIGRATION_ERROR` with version + name, do NOT record as applied

**Errors:**
- `MIGRATION_ERROR` — up() function failed (wraps original error, includes version + name)
- `SCHEMA_ERROR` — duplicate version numbers, non-ascending order
- `AUTH_ERROR`, `PERMISSION_ERROR`, `RATE_LIMIT`, `NETWORK_ERROR`, `API_ERROR` — transport errors

---

## 7. Utility Functions

### `createSpreadsheet(title, auth)`

**Signature:**
```typescript
function createSpreadsheet(
  title: string,
  auth: string | (() => Promise<string>)
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }>
```

**Behavior:**
1. POST to `https://sheets.googleapis.com/v4/spreadsheets` with `{ properties: { title } }`
2. Return `spreadsheetId` and `spreadsheetUrl` from response

---

### `extractSpreadsheetId(urlOrId)`

**Signature:**
```typescript
function extractSpreadsheetId(urlOrId: string): string | null
```

**Behavior:**
- If input matches `/spreadsheets/d/([^/]+)/`: return captured group
- If input looks like a bare ID (no slashes): return as-is
- Otherwise: return null

---

### Utility Helpers (re-exported)

```typescript
function generateId(): string;                      // Timestamp + random
function isValidDate(date: string): boolean;        // YYYY-MM-DD check
function normalizeDate(value: unknown): string | null;  // Coerce to ISO date
function parseAmount(value: unknown): number | null;    // Parse currency strings
function findMissingHeaders(actual: string[], required: string[]): string[];  // Header validation
```

---

## 8. Error Factory Functions

```typescript
function authError(message: string, cause?: unknown): GenjutsuError;
function permissionError(message: string, cause?: unknown): GenjutsuError;
function rateLimitError(message: string, retryAfterMs?: number, cause?: unknown): GenjutsuError;
function networkError(message: string, cause?: unknown): GenjutsuError;
function validationError(message: string, issues: ValidationIssue[]): GenjutsuError;
function schemaError(message: string, cause?: unknown): GenjutsuError;
function migrationError(message: string, version: number, name: string, cause?: unknown): GenjutsuError;
function apiError(message: string, cause?: unknown): GenjutsuError;
function isGenjutsuError(err: unknown): err is GenjutsuError;
```

---

## 9. WriteOptions (shared)

```typescript
interface WriteOptions {
  skipFkValidation?: boolean;  // Skip FK validation for this write (default: false)
}
```

---

## 10. Public Exports Summary

### Functions (8)
- `createClient` — client factory
- `defineModel` — model definition
- `createSpreadsheet` — spreadsheet provisioning
- `extractSpreadsheetId` — URL parsing
- `generateId`, `isValidDate`, `normalizeDate`, `parseAmount`, `findMissingHeaders` — utilities
- `isGenjutsuError` — error type guard

### Types (12)
- `GenjutsuClient<S>` — client interface
- `ClientConfig<S>` — client configuration
- `SheetSchema<T>` — schema interface
- `InferEntity<S>` — entity type inference helper
- `Repository<T>` — repository interface
- `FieldDef<T>` — field definition
- `Migration` — migration definition
- `MigrationContext` — migration operations
- `GenjutsuError` — error class
- `GenjutsuErrorKind` — error kind union
- `ValidationIssue` — validation issue
- `FormattingRule` — formatting rule

### Constants (1)
- `field` — field builder namespace (`field.string()`, etc.)

**Total public API surface: 21 symbols** (functions + types + constants)
