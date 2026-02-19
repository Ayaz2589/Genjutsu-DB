# Research: genjutsu-db

**Feature Branch**: `001-genjutsu-db`
**Date**: 2026-02-19

## R1: Google Sheets API v4 Endpoints Required

### Decision
Use 10 distinct Google Sheets API v4 REST endpoints via native `fetch`. No Google client libraries.

### Rationale
The existing sheets-db in budget-tool already uses 8 of these endpoints successfully. The remaining 2 (batchGet, spreadsheets.create) are well-documented and follow the same patterns. Native `fetch` keeps the zero-dependency constraint.

### Endpoints Catalog

| Operation | Method | Endpoint | Used By |
|-----------|--------|----------|---------|
| Read single range | GET | `/v4/spreadsheets/{id}/values/{range}` | readAll, findById, findMany |
| Write/replace values | PUT | `/v4/spreadsheets/{id}/values/{range}` | writeAll, update, delete |
| Append values | POST | `/v4/spreadsheets/{id}/values/{range}:append` | append, create |
| Clear range | POST | `/v4/spreadsheets/{id}/values/{range}:clear` | writeAll (before write) |
| Batch clear | POST | `/v4/spreadsheets/{id}/values:batchClear` | batchSync |
| Batch update values | POST | `/v4/spreadsheets/{id}/values:batchUpdate` | batchSync |
| Batch get values | GET | `/v4/spreadsheets/{id}/values:batchGet` | include (eager loading), migration reads |
| Structural batchUpdate | POST | `/v4/spreadsheets/{id}:batchUpdate` | ensureSchema, applyFormatting, migrations |
| Get metadata | GET | `/v4/spreadsheets/{id}?fields=sheets.properties(sheetId,title)` | ensureSchema, applyFormatting, migrations |
| Create spreadsheet | POST | `/v4/spreadsheets` | createSpreadsheet utility |

### Alternatives Considered
- **Google API Client Library (googleapis)**: Rejected — adds ~2MB runtime dependency, violates Constitution Principle II.
- **gaxios/node-fetch**: Rejected — unnecessary abstraction over native `fetch`, adds dependency.

---

## R2: Token Provider Pattern

### Decision
Accept authentication via `token: string | (() => Promise<string>)`. Call the provider before each API request. On 401, call the provider once for a fresh token and retry the request exactly once.

### Rationale
Google OAuth2 access tokens expire after 1 hour. In browser-side applications, token refresh typically happens via Google Identity Services (GIS) which returns short-lived tokens. The library cannot (and should not) manage the OAuth flow — it only consumes tokens. The async function pattern lets the consumer's GIS integration provide fresh tokens on demand.

### Implementation Pattern
```
1. Before each API call: token = typeof auth === 'string' ? auth : await auth()
2. Make API call with token
3. If 401: token = typeof auth === 'string' ? throw authError : await auth()
4. Retry API call once with new token
5. If still 401: throw authError (refresh token likely revoked)
```

### Alternatives Considered
- **Static token only**: Rejected — tokens expire after 1 hour, library would be unusable for long sessions.
- **Built-in OAuth flow**: Rejected — requires client_secret, redirect URIs, and UI. Out of scope for a data library.
- **Proactive refresh (check expires_in)**: Rejected for v1 — adds complexity, the retry-on-401 pattern is simpler and sufficient.

---

## R3: Public Sheet Access

### Decision
For public/published sheets, accept an optional API key instead of an OAuth token. Reads use `?key={apiKey}` query parameter. Writes are blocked at the library level (throw PERMISSION_ERROR before making any API call).

### Rationale
Google Sheets API v4 requires at least an API key for all requests — there is no truly unauthenticated access. API keys are free, require no user consent, and work for any publicly shared sheet. The library should distinguish between "no auth needed for reads" (API key) and "full auth needed for writes" (OAuth token).

### Implementation Pattern
- Connection config: `{ spreadsheetId, auth?: string | (() => Promise<string>), apiKey?: string }`
- If `auth` is provided: use `Authorization: Bearer {token}` header for all requests
- If only `apiKey` is provided: use `?key={apiKey}` for reads, throw PERMISSION_ERROR on writes
- If neither: throw AUTH_ERROR on any operation

### Alternatives Considered
- **Proxy services (opensheet.elk.sh)**: Rejected — third-party dependency, unreliable, not official API.
- **No public sheet support**: Rejected — it's a common sharing pattern, trivial to implement.

---

## R4: Column Manipulation for Migrations

### Decision
Use Google Sheets `batchUpdate` structural requests for all migration operations: `insertDimension` (add column), `deleteDimension` (remove column), `updateCells` (rename column header), `addSheet` (create sheet), `updateSheetProperties` (rename sheet).

### Rationale
All five operations are supported via the same `batchUpdate` endpoint, allowing multiple structural changes in a single API call per migration. This is efficient and atomic within a single batchUpdate request.

### Request Shapes

**Add column** (insertDimension):
```json
{ "insertDimension": { "range": { "sheetId": 0, "dimension": "COLUMNS", "startIndex": N, "endIndex": N+1 }, "inheritFromBefore": false } }
```

**Remove column** (deleteDimension):
```json
{ "deleteDimension": { "range": { "sheetId": 0, "dimension": "COLUMNS", "startIndex": N, "endIndex": N+1 } } }
```

**Rename column header** (updateCells):
```json
{ "updateCells": { "start": { "sheetId": 0, "rowIndex": 0, "columnIndex": N }, "rows": [{ "values": [{ "userEnteredValue": { "stringValue": "new_name" } }] }], "fields": "userEnteredValue" } }
```

**Create sheet** (addSheet):
```json
{ "addSheet": { "properties": { "title": "SheetName" } } }
```

**Rename sheet** (updateSheetProperties):
```json
{ "updateSheetProperties": { "properties": { "sheetId": 0, "title": "NewName" }, "fields": "title" } }
```

### Key Constraint
All structural operations require the numeric `sheetId` (not the tab name). The migration context must resolve sheet names to IDs by fetching metadata first.

### Alternatives Considered
- **Delete + recreate sheet for column changes**: Rejected — destroys data, not a migration.
- **Values API for column operations**: Rejected — Values API can update cell content but cannot insert/delete columns.

---

## R5: defineModel Type Inference

### Decision
Use TypeScript mapped types and builder pattern to infer entity types from field definitions. The `defineModel()` function returns a `ModelDefinition<T>` where `T` is automatically inferred from the field declarations — no manual type parameter needed.

### Rationale
Drizzle ORM pioneered this pattern in the TypeScript ecosystem. It provides the developer experience of Prisma (declarative schema → typed operations) without code generation. The key insight is that TypeScript's `infer` and mapped types can derive a record type from a schema definition object at compile time.

### Type Inference Pattern
```typescript
// Field builder functions return typed descriptors
field.string()   → FieldDef<string>
field.number()   → FieldDef<number>
field.date()     → FieldDef<string>  (ISO date strings)
field.boolean()  → FieldDef<boolean>

// Options modify the type
.optional()      → FieldDef<T | null>
.default(v)      → keeps FieldDef<T> (required in entity, optional in create input)
.primaryKey()    → marks field as PK (no type change)

// defineModel infers T from field declarations
defineModel("contacts", {
  id:    field.string().primaryKey(),
  name:  field.string(),
  email: field.string().optional(),
  age:   field.number().default(0),
})
// Inferred type: { id: string; name: string; email: string | null; age: number }
```

### Alternatives Considered
- **Prisma-style codegen**: Rejected — requires CLI tool, build step, generated files. Violates Constitution Principle III.
- **Zod-based schemas**: Rejected — adds runtime dependency. Violates Constitution Principle II.
- **Manual generic parameter**: Rejected — requires consumer to define both the type AND the schema, duplicating the definition.

---

## R6: Write Mutex Pattern

### Decision
Keep the existing Promise-chain queue pattern from sheets-db. It serializes all write operations without external dependencies.

### Rationale
The pattern is proven in production (budget-tool uses it), simple to understand, and requires zero dependencies. It works correctly in single-tab browser environments, which is the target platform.

### Pattern
```typescript
let writeLock: Promise<void> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let resolve: () => void;
  writeLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}
```

### Alternatives Considered
- **Web Locks API**: Rejected — not available in all browsers, more complex, unnecessary for single-tab use.
- **No serialization**: Rejected — interleaved API calls can corrupt sheet data (clear from one write overlapping with another's write).

---

## R7: Error System Design

### Decision
Rename `SheetsDbError` to `GenjutsuError`, add `PERMISSION_ERROR` (403) and `MIGRATION_ERROR` kinds. Keep deprecated aliases for backward compatibility during transition.

### Error Kinds (8 total)

| Kind | HTTP Status | When |
|------|-------------|------|
| AUTH_ERROR | 401 | Token invalid/expired (after retry) |
| PERMISSION_ERROR | 403 | Read-only access, insufficient permissions |
| RATE_LIMIT | 429 | Google API rate limit exceeded |
| NETWORK_ERROR | — | `fetch()` threw (offline, DNS, etc.) |
| VALIDATION_ERROR | — | Field validation, FK validation, duplicate PK |
| SCHEMA_ERROR | — | Invalid model definition, duplicate sheet names |
| MIGRATION_ERROR | — | Migration failed (wraps cause, includes version/name) |
| API_ERROR | Other | Catch-all for non-categorized HTTP errors |

### Alternatives Considered
- **Keep SheetsDbError name**: Rejected — the library is no longer called sheets-db.
- **Separate error classes per kind**: Rejected — discriminated union on `.kind` is simpler and more TypeScript-idiomatic.

---

## R8: Batch Get Values for Eager Loading

### Decision
Use `batchGet` endpoint for eager loading (`include` option). When a findMany/readAll call includes related models, fetch all required ranges in a single batchGet call instead of N sequential getSheetValues calls.

### Rationale
Eager loading for N related models would require N+1 API calls with sequential reads. `batchGet` collapses the N related reads into 1 call, reducing to 2 total API calls (1 for primary + 1 batchGet for all related).

### Endpoint
```
GET /v4/spreadsheets/{id}/values:batchGet?ranges=Sheet1!A1:Z&ranges=Sheet2!A1:Z
```

Ranges are passed as repeated query parameters. Response `valueRanges` array matches request order.

### Alternatives Considered
- **Sequential reads**: Rejected — O(N) API calls for N related models. Slow and wasteful.
- **No eager loading (manual joins)**: Rejected — forces every consumer to implement the same join logic.

---

## R9: Migration Tracking Sheet

### Decision
Track applied migrations in a `_genjutsu_migrations` sheet tab with columns: `version`, `name`, `applied_at`. The sheet is auto-created on first `db.migrate()` call.

### Rationale
The tracking sheet is itself a Google Sheet tab, requiring no external storage. The underscore prefix convention signals it's an internal/system tab. Reading applied migrations before running new ones is a single `getSheetValues` call.

### Schema
| Column | Type | Description |
|--------|------|-------------|
| version | number | Sequential migration version |
| name | string | Human-readable migration name |
| applied_at | string | ISO timestamp of when migration was applied |

### Alternatives Considered
- **Store in spreadsheet properties (metadata)**: Rejected — properties have size limits and are less inspectable.
- **External tracking file**: Rejected — the library has no file system access (browser-side).
- **Hash-based tracking**: Rejected — simpler to use sequential version numbers.
