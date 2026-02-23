# genjutsu-db

![Sharingan_triple](https://github.com/user-attachments/assets/51599bd6-ec15-4046-aebf-6e7c1e3e603d)

A TypeScript-first Google Sheets database library with zero runtime dependencies.

Use Google Sheets as a structured database with typed models, full CRUD, relations, migrations, and formatting — all from the browser or server with just `fetch`.

## Features

- **`defineModel()` API** — Drizzle-style schema definitions with chainable field builders
- **Full CRUD** — `create`, `findById`, `findMany`, `update`, `delete`, `readAll`, `writeAll`, `append`
- **Relations** — Foreign key validation on write + eager loading via `include`
- **Migrations** — Versioned schema changes tracked in a `_genjutsu_migrations` sheet
- **Formatting** — Header styles, number formats, alignment rules
- **Token provider** — Supports static tokens or async refresh functions with automatic 401 retry
- **Raw range access** — `db.raw.readRange()`, `writeRange()`, `clearRange()` for non-model sheets
- **Write mutex** — Serializes concurrent writes to prevent interleaved API calls
- **Read-only mode** — Use `apiKey` for public sheets (writes are blocked at the client level)
- **Zero dependencies** — Pure `fetch`-based, works in any JS runtime (browser, Node, Bun, Deno)

## Install

```bash
bun add genjutsu-db
# or
npm install genjutsu-db
```

## Quick Start

```typescript
import { createClient, createSpreadsheet, defineModel, field, generateId } from "genjutsu-db";

// 1. Define models
const Contact = defineModel("Contacts", {
  id: field.string().primaryKey(),
  name: field.string(),
  email: field.string().optional(),
  age: field.number().optional(),
});

const Note = defineModel("Notes", {
  id: field.string().primaryKey(),
  contactId: field.string().references("contacts", "id"),
  text: field.string(),
  createdAt: field.date(),
});

// 2. Create a spreadsheet (or use an existing one)
const { spreadsheetId } = await createSpreadsheet("My App", oauthToken);

// 3. Create client
const db = createClient({
  spreadsheetId,
  auth: oauthToken,
  schemas: { contacts: Contact, notes: Note },
});

// 4. Ensure sheet tabs exist
await db.ensureSchema();

// 5. CRUD
const alice = await db.repo("contacts").create({
  id: generateId(),
  name: "Alice",
  email: "alice@example.com",
  age: 30,
});

const found = await db.repo("contacts").findById(alice.id);
const adults = await db.repo("contacts").findMany((c) => (c.age ?? 0) >= 18);
const updated = await db.repo("contacts").update(alice.id, { age: 31 });
await db.repo("contacts").delete(alice.id);
```

## API

### `defineModel(sheetName, fields)`

Define a typed model that maps to a Google Sheets tab.

```typescript
const Task = defineModel("Tasks", {
  id: field.string().primaryKey(),
  title: field.string(),
  done: field.boolean().default(false),
  priority: field.number().optional(),
  dueDate: field.date().optional(),
  assigneeId: field.string().references("users", "id"),
});
```

**Field types:** `field.string()`, `field.number()`, `field.date()`, `field.boolean()`

**Field modifiers:**
| Method | Description |
|--------|-------------|
| `.primaryKey()` | Mark as primary key (exactly one required per model) |
| `.optional()` | Allow `null` values |
| `.default(value)` | Set a default value for missing cells |
| `.references(model, field)` | Declare a foreign key relation |

### `createClient(config)`

Create a client with typed repositories.

```typescript
const db = createClient({
  spreadsheetId: "1BxiMVs0XRA...",
  auth: token,           // string or async () => Promise<string>
  schemas: { tasks: Task, users: User },
});
```

| Option | Type | Description |
|--------|------|-------------|
| `spreadsheetId` | `string` | Google Sheets spreadsheet ID or full URL |
| `auth` | `string \| () => Promise<string>` | OAuth token or async token provider |
| `apiKey` | `string` | API key for read-only access to public sheets |
| `schemas` | `Record<string, SheetSchema>` | Named schemas (keys become repo names) |

> Provide `auth` for read/write or `apiKey` for read-only. At least one is required.

### Repository Methods

Access via `db.repo("modelName")`:

```typescript
const repo = db.repo("tasks");
```

| Method | Returns | Description |
|--------|---------|-------------|
| `create(record, options?)` | `Promise<T>` | Insert a new record (validates PK uniqueness + FK refs) |
| `findById(id)` | `Promise<T \| null>` | Find a single record by primary key |
| `findMany(filter?, options?)` | `Promise<T[]>` | Find records, optionally filtered |
| `update(id, changes, options?)` | `Promise<T>` | Partial update by primary key |
| `delete(id)` | `Promise<void>` | Delete by primary key |
| `readAll(options?)` | `Promise<T[]>` | Read all records |
| `writeAll(records)` | `Promise<void>` | Overwrite all records (clear + write) |
| `append(records)` | `Promise<void>` | Append records to the sheet |

### Relations & Eager Loading

Foreign keys are validated on `create()` and `update()` — the referenced record must exist.

```typescript
// Eager load related records
const contacts = await db.repo("contacts").findMany(undefined, {
  include: { notes: true },
});

// Each contact now has a `notes` array attached
for (const contact of contacts) {
  console.log(contact.name, contact.notes.length);
}
```

Skip FK validation when needed:

```typescript
await db.repo("notes").create(record, { skipFkValidation: true });
```

### Batch Sync

Overwrite multiple sheets atomically in a single API call:

```typescript
await db.batchSync({
  tasks: allTasks,
  users: allUsers,
});
```

### Schema Management

```typescript
// Create missing sheet tabs
await db.ensureSchema();

// Apply header and cell formatting
await db.applyFormatting();
```

### Migrations

Versioned schema changes with structural operations:

```typescript
await db.migrate([
  {
    version: 1,
    name: "add-status-column",
    up: async (ctx) => {
      await ctx.addColumn("Tasks", "status", 3);
    },
  },
  {
    version: 2,
    name: "create-tags-sheet",
    up: async (ctx) => {
      await ctx.createSheet("Tags");
    },
  },
]);
```

**Migration context operations:**

| Method | Description |
|--------|-------------|
| `createSheet(name)` | Add a new sheet tab |
| `addColumn(sheet, name, afterIndex?)` | Insert a column |
| `removeColumn(sheet, columnIndex)` | Delete a column |
| `renameColumn(sheet, columnIndex, newName)` | Rename a column header |
| `renameSheet(oldName, newName)` | Rename a sheet tab |

Applied migrations are tracked in `_genjutsu_migrations` (auto-created). Already-applied migrations are skipped on subsequent runs.

### Error Handling

All errors are typed `GenjutsuError` instances with a `kind` discriminator:

```typescript
import { isGenjutsuError } from "genjutsu-db";

try {
  await db.repo("tasks").create(record);
} catch (err) {
  if (isGenjutsuError(err)) {
    switch (err.kind) {
      case "AUTH_ERROR":        // 401 — token expired or invalid
      case "PERMISSION_ERROR":  // 403 — no access to spreadsheet
      case "RATE_LIMIT":        // 429 — err.retryAfterMs available
      case "NETWORK_ERROR":     // fetch failed
      case "VALIDATION_ERROR":  // FK check failed, duplicate PK, etc.
      case "SCHEMA_ERROR":      // bad config, missing sheet
      case "MIGRATION_ERROR":   // err.migrationVersion, err.migrationName
      case "API_ERROR":         // other Google Sheets API errors
    }
  }
}
```

### Token Provider Pattern

For applications that need token refresh:

```typescript
const db = createClient({
  spreadsheetId: "...",
  auth: async () => {
    // Return a fresh token — called on each request
    // On 401, the library retries once with a new token
    return await refreshOAuthToken();
  },
  schemas: { tasks: Task },
});
```

### Utilities

```typescript
import {
  generateId,          // Generate a random ID string
  extractSpreadsheetId, // Parse spreadsheet ID from URL
  createSpreadsheet,   // Create a new Google Sheet
} from "genjutsu-db";

const id = generateId();
const sheetId = extractSpreadsheetId("https://docs.google.com/spreadsheets/d/abc123/edit");
const { spreadsheetId, spreadsheetUrl } = await createSpreadsheet("Title", token);
```

### Raw Range Access

For sheets that don't fit a model (data blobs, summary tabs, etc.), use `db.raw` to read, write, and clear arbitrary ranges. Raw writes participate in the write mutex, so they're safe to use alongside model operations.

```typescript
// Read raw cell values
const rows = await db.raw.readRange("Summary!A1:D10");
// rows: unknown[][] — e.g. [["Total", 1500], ["Average", 375]]

// Read with unformatted values (numbers instead of formatted strings)
const unformatted = await db.raw.readRange("Summary!A1:D10", "UNFORMATTED_VALUE");

// Write raw values (overwrites the range)
await db.raw.writeRange("Summary!A1:B2", [
  ["Total Expenses", 1500],
  ["Total Income", 3200],
]);

// Clear a range
await db.raw.clearRange("Summary!A1:D10");
```

| Method | Returns | Description |
|--------|---------|-------------|
| `readRange(range, valueRenderOption?)` | `Promise<unknown[][]>` | Read cell values from a range |
| `writeRange(range, values)` | `Promise<void>` | Overwrite a range with values |
| `clearRange(range)` | `Promise<void>` | Clear all values in a range |

> `readRange` works on both read-write and read-only clients. `writeRange` and `clearRange` throw `PERMISSION_ERROR` on read-only (`apiKey`) clients.

### Raw Schemas

For full control, skip `defineModel()` and provide a raw `SheetSchema<T>`:

```typescript
import { createClient, type SheetSchema } from "genjutsu-db";

interface Task {
  id: string;
  title: string;
  done: boolean;
}

const TaskSchema: SheetSchema<Task> = {
  sheetName: "Tasks",
  headers: ["id", "title", "done"],
  readRange: "Tasks!A2:C",
  writeRange: "Tasks!A1:C",
  clearRange: "Tasks!A2:C",
  primaryKey: "id",
  parseRow: (row) => {
    if (!row[0]) return null;
    return {
      id: String(row[0]),
      title: String(row[1] ?? ""),
      done: row[2] === true || row[2] === "TRUE",
    };
  },
  toRow: (t) => [t.id, t.title, t.done],
};

const db = createClient({
  spreadsheetId: "...",
  auth: token,
  schemas: { tasks: TaskSchema },
});
```

## Authentication

genjutsu-db requires a Google OAuth2 token with the `https://www.googleapis.com/auth/spreadsheets` scope. The library does not handle OAuth flows — you provide the token.

**Common approaches:**
- **Browser apps** — Use Google Identity Services (GIS) or `@react-oauth/google`
- **Server apps** — Use a service account or OAuth2 client credentials
- **Quick testing** — Use the [OAuth Playground](https://developers.google.com/oauthplayground/) to get a temporary token

## Running the Demo

```bash
# Get a token from https://developers.google.com/oauthplayground/
# Select "Google Sheets API v4" scope

GOOGLE_TOKEN="your-token" bun run demo.ts

# Or use an existing spreadsheet:
GOOGLE_TOKEN="your-token" SHEET_ID="spreadsheet-id" bun run demo.ts
```

## Development

```bash
bun install       # Install dependencies
bun test          # Run tests (277 tests)
bun test --coverage  # Coverage report (99.7% lines, 100% functions)
bun run build     # TypeScript build to dist/
bun run lint      # Type check
```

## Architecture

```
src/
  client.ts      — createClient() factory, repo builder, write mutex
  model.ts       — defineModel(), field builders, parseRow/toRow/validate generation
  relations.ts   — FK validation (validateForeignKeys) + eager loading (loadRelated)
  migrations.ts  — Migration runner + MigrationContext structural operations
  transport.ts   — Google Sheets v4 REST wrappers (GET/PUT/POST/batchGet/batchUpdate)
  errors.ts      — GenjutsuError class with 8 typed error kinds
  types.ts       — All TypeScript interfaces and type definitions
  utils.ts       — generateId, date parsing, header validation helpers
  index.ts       — Public API barrel export
```

## License

MIT
