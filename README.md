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
- **Drive workspace** — Automatic folder/sheet creation in Google Drive with `appProperties`-based isolation
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

## Drive Workspace

Most apps need a dedicated folder and spreadsheet in each user's Google Drive. The workspace API handles this automatically — finding or creating an app-specific folder and spreadsheet using Google Drive's `appProperties` metadata, which is private to your OAuth client ID and invisible to the user.

### Why `appProperties`?

Google Drive doesn't enforce unique folder names. A user might already have a folder called "Budget" for personal use. If genjutsu-db searched by name, it could collide with that folder. `appProperties` solves this:

- **Private per OAuth client ID** — other apps (and even other genjutsu-db apps with different OAuth clients) cannot see your metadata
- **Survives renames** — if the user renames "Budget" to "My Finances", the library still finds it
- **Query-able** — `appProperties has { key='genjutsuApp' and value='budget' }` returns only your files
- **Invisible in Drive UI** — the user sees a normal folder, not developer naming conventions

### `resolveWorkspace(config)`

Find or create an app-specific folder and spreadsheet in one call:

```typescript
import { resolveWorkspace, createClient, defineModel, field } from "genjutsu-db";

const Task = defineModel("Tasks", {
  id: field.string().primaryKey(),
  title: field.string(),
  done: field.boolean().default(false),
});

// Finds or creates a "Task Tracker" folder with a "Tasks DB" spreadsheet
const workspace = await resolveWorkspace({
  appId: "task-tracker",              // unique ID stored in appProperties
  folderName: "Task Tracker",         // what the user sees in Drive (defaults to appId)
  defaultSpreadsheetName: "Tasks DB", // created on first run
  auth: getAccessToken,               // OAuth token or async provider
});

// workspace.folderId       — Google Drive folder ID
// workspace.spreadsheetId  — primary spreadsheet ID (most recently modified)
// workspace.spreadsheets   — all spreadsheets in the folder [{id, name}, ...]
// workspace.created        — true if folder and/or spreadsheet were created

const db = createClient({
  spreadsheetId: workspace.spreadsheetId,
  auth: getAccessToken,
  schemas: { tasks: Task },
});
```

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `appId` | `string` | Yes | — | Unique app identifier, stored in `appProperties.genjutsuApp` |
| `folderName` | `string` | No | `appId` | Human-readable folder name shown in Google Drive |
| `defaultSpreadsheetName` | `string` | Yes | — | Name for the spreadsheet created on first run |
| `auth` | `string \| () => Promise<string>` | Yes | — | OAuth token or async provider (API keys not supported) |

**How it works:**

1. Queries Drive for folders with `appProperties.genjutsuApp === appId` (ordered by most recently modified)
2. If no folder found → creates one with `appProperties: { genjutsuApp, genjutsuType: "appFolder" }`
3. Lists spreadsheets in the folder (excludes trashed)
4. If no spreadsheets → creates one with `appProperties: { genjutsuApp, genjutsuType: "spreadsheet" }` directly in the folder via `drive.files.create` with `parents: [folderId]`
5. Returns the folder ID, all spreadsheets, and the primary (most recently modified) spreadsheet ID

**What the user sees in Drive:**

```
My Drive/
  Task Tracker/          ← normal folder (appProperties are invisible)
    Tasks DB.gsheet      ← normal spreadsheet
```

### `createManagedClient(config)`

Combines `resolveWorkspace()` + `createClient()` into a single call:

```typescript
import { createManagedClient, defineModel, field } from "genjutsu-db";

const Task = defineModel("Tasks", {
  id: field.string().primaryKey(),
  title: field.string(),
  done: field.boolean().default(false),
});

const { client, workspace } = await createManagedClient({
  appId: "task-tracker",
  folderName: "Task Tracker",
  defaultSpreadsheetName: "Tasks DB",
  auth: getAccessToken,
  schemas: { tasks: Task },
});

// client is a fully configured GenjutsuClient
await client.ensureSchema();
await client.repo("tasks").create({ id: "1", title: "Ship it" });

// workspace has the resolved Drive metadata
console.log(workspace.spreadsheetId, workspace.created);
```

### Low-Level Drive Functions

For custom workspace flows (multi-spreadsheet selection, manual folder management):

```typescript
import {
  findAppFolder,
  createAppFolder,
  listSpreadsheetsInFolder,
  createSpreadsheetInFolder,
} from "genjutsu-db";

const ctx = { auth: getAccessToken };

// Find existing folder by appProperties
let folder = await findAppFolder(ctx, "my-app");
// → { id: string, name: string } | null

// Create folder if not found
if (!folder) {
  folder = await createAppFolder(ctx, "my-app", "My App Data");
  // → { id: string, name: string }
  // Created with appProperties: { genjutsuApp: "my-app", genjutsuType: "appFolder" }
}

// List all spreadsheets in folder (ordered by most recently modified)
const sheets = await listSpreadsheetsInFolder(ctx, folder.id);
// → Array<{ id: string, name: string }>

// Create a new spreadsheet in the folder
const newSheet = await createSpreadsheetInFolder(ctx, folder.id, "January 2026", "my-app");
// → { id: string, name: string }
// Created with parents: [folderId] and appProperties: { genjutsuApp: "my-app", genjutsuType: "spreadsheet" }
```

| Function | Parameters | Returns | Description |
|----------|-----------|---------|-------------|
| `findAppFolder(ctx, appId)` | `DriveContext`, `string` | `Promise<{id, name} \| null>` | Find folder by `appProperties` query |
| `createAppFolder(ctx, appId, folderName)` | `DriveContext`, `string`, `string` | `Promise<{id, name}>` | Create tagged folder |
| `listSpreadsheetsInFolder(ctx, folderId)` | `DriveContext`, `string` | `Promise<{id, name}[]>` | List spreadsheets in folder |
| `createSpreadsheetInFolder(ctx, folderId, title, appId)` | `DriveContext`, `string`, `string`, `string` | `Promise<{id, name}>` | Create tagged spreadsheet in folder |

All Drive functions use the same auth pattern (static token or async provider), 401 retry, and typed error handling as Sheets operations. Errors are mapped to `GenjutsuError` kinds: `AUTH_ERROR` (401), `PERMISSION_ERROR` (403), `RATE_LIMIT` (429), `NETWORK_ERROR` (fetch failure), `DRIVE_ERROR` (other Drive API errors).

### OAuth Scope

The workspace API requires the `drive.file` scope:

```
https://www.googleapis.com/auth/drive.file
```

This is the **least-privilege** Drive scope — it only grants access to files your app created or the user opened with your app. It does **not** grant access to the user's entire Google Drive.

> If your app also uses `createClient()` with model CRUD, you'll need both `drive.file` and `spreadsheets` scopes.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| First-time user | Creates folder + spreadsheet. `created: true`. |
| Returning user | Finds existing folder + sheet. `created: false`. |
| Folder trashed by user | Query includes `trashed=false` — folder not found, new one created. |
| Spreadsheet trashed | Listing excludes trashed — new default spreadsheet created. |
| User renames folder | Still found by `appProperties`, not by name. |
| User has personal folder with same name | No collision — query filters by `appProperties` metadata. |
| Multiple folders with same `appId` | Most recently modified is selected. |
| Insufficient OAuth scope | 403 → `PERMISSION_ERROR` with descriptive message. |

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
      case "DRIVE_ERROR":       // Google Drive API errors (folder/file operations)
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

genjutsu-db requires a Google OAuth2 token. The library does not handle OAuth flows — you provide the token.

**Required scopes:**

| Feature | Scope |
|---------|-------|
| Model CRUD, raw range, migrations | `https://www.googleapis.com/auth/spreadsheets` |
| Drive workspace (`resolveWorkspace`, Drive functions) | `https://www.googleapis.com/auth/drive.file` |

> `drive.file` is the least-privilege Drive scope — it only accesses files your app created. If your app uses both model CRUD and Drive workspace, include both scopes.

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
bun test          # Run tests (348 tests)
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
  http.ts        — Shared HTTP infrastructure (auth, 401 retry, error wrapping)
  transport.ts   — Google Sheets v4 REST wrappers (GET/PUT/POST/batchGet/batchUpdate)
  drive.ts       — Google Drive v3 REST wrappers (folder/spreadsheet CRUD with appProperties)
  workspace.ts   — resolveWorkspace() orchestrator (find or create folder + spreadsheet)
  managed.ts     — createManagedClient() convenience (workspace + client in one call)
  errors.ts      — GenjutsuError class with 9 typed error kinds
  types.ts       — All TypeScript interfaces and type definitions
  utils.ts       — generateId, date parsing, header validation helpers
  index.ts       — Public API barrel export
```

## License

MIT
