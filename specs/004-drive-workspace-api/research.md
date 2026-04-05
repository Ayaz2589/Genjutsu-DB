# Research: Drive Workspace API

**Branch**: `004-drive-workspace-api` | **Date**: 2026-04-05

## R1: Drive v3 appProperties — Query Syntax & Creation

**Decision**: Use `appProperties has { key='genjutsuApp' and value='<appId>' }` as the query filter, combined with `mimeType` and `trashed=false`.

**Rationale**: This is the documented Drive v3 query syntax for custom properties. Multiple conditions combine with `and`. The query is indexed by Google and performs well.

**Creation body**:
```json
{
  "name": "Budget",
  "mimeType": "application/vnd.google-apps.folder",
  "appProperties": {
    "genjutsuApp": "budget",
    "genjutsuType": "appFolder"
  }
}
```

`appProperties` is a flat `Record<string, string>` in the request body.

**Alternatives considered**: Using `properties` (public) instead of `appProperties` (private). Rejected because public properties are visible to all apps with access to the file, defeating the isolation goal.

## R2: appProperties Isolation — Confirmed

**Decision**: Rely on appProperties for complete app isolation.

**Rationale**: appProperties are **private per OAuth client ID**. App A cannot read or write App B's appProperties on the same file. This is enforced at the Google API level, not by naming conventions.

**Alternatives considered**: Folder naming conventions (e.g., `[genjutsu:budget]`). Rejected — collides with user folders, ugly in Drive UI, not enforced by the API.

## R3: appProperties Limits

**Decision**: Keep property keys short to maximize value space.

| Constraint | Limit |
|---|---|
| Max key+value size | 124 bytes (UTF-8, combined) |
| Max private properties per app per file | 30 |
| Max total custom properties per file (all apps) | 100 |

**Rationale**: Our keys (`genjutsuApp`, `genjutsuType`) total ~25 bytes, leaving ~99 bytes for values. `appId` values like `"budget"` or `"inventory"` fit easily.

## R4: OAuth Scope

**Decision**: Require `https://www.googleapis.com/auth/drive.file` (least-privilege scope).

**Rationale**: `drive.file` grants access only to files the app created or the user opened with the app. This is ideal — the library creates its own folders/spreadsheets, so they're all visible via this scope. User's personal files remain inaccessible.

**Alternatives considered**: `drive` (full access) — triggers stricter Google OAuth review and grants unnecessary broad access. `drive.readonly` — cannot create folders/files.

## R5: Spreadsheet Creation Strategy

**Decision**: Create spreadsheets directly in the target folder using Drive `files.create` with `parents: [folderId]` and `mimeType: application/vnd.google-apps.spreadsheet`, instead of the create-then-move pattern.

**Rationale**: Single API call vs. three (Sheets create + get parents + PATCH move). Drive `files.create` with the spreadsheet mimeType creates a valid Google Sheets file directly. We can also set `appProperties` in the same call.

```json
POST https://www.googleapis.com/drive/v3/files
{
  "name": "Budget Data",
  "mimeType": "application/vnd.google-apps.spreadsheet",
  "parents": ["<folderId>"],
  "appProperties": {
    "genjutsuApp": "budget",
    "genjutsuType": "spreadsheet"
  }
}
```

The response includes the file `id` which is the `spreadsheetId` for the Sheets API.

**Alternatives considered**: Sheets API `create` + Drive API `move`. Rejected — 3 API calls instead of 1, more failure modes, more complex error handling. The only advantage (control over initial sheet tab names) is not needed since `ensureSchema()` handles tab setup.

## R6: supportsAllDrives Parameter

**Decision**: Include `supportsAllDrives=true` and `includeItemsFromAllDrives=true` on all list/get/update calls.

**Rationale**: Without these params, files in shared drives are silently excluded. The params are harmless on personal drives and ensure correctness for users who organize their data in shared drives.

## R7: HTTP Extraction Design

**Decision**: Extract shared HTTP logic into `src/http.ts` with a minimal `HttpContext` interface.

### Shared interface:
```typescript
export interface HttpContext {
  auth?: string | (() => Promise<string>);
  apiKey?: string;
}
```

### Moves to `src/http.ts`:
- `HttpContext` interface
- `resolveToken(auth)` — static string or async provider
- `fetchWithErrorHandling(url, init, ctx: HttpContext, retryOn401?)` — 401 retry + error mapping
- `buildAuthHeaders(ctx: HttpContext)` — Authorization header builder
- `appendParams(url, extra)` — URL param helper
- `parseRetryAfterMs(res)` — Retry-After header extraction
- `wrapHttpError(status, body, cause)` — HTTP status to GenjutsuError mapping

### Stays in `src/transport.ts`:
- `TransportContext extends HttpContext` (adds `spreadsheetId`)
- `SHEETS_API` constant
- `extractSpreadsheetId()`
- `buildApiKeyParam()` — Sheets-specific (Drive uses OAuth, not API keys)
- All Sheets API functions (unchanged)

**Rationale**: `fetchWithErrorHandling` only reads `ctx.auth` for 401 retry logic — it never touches `spreadsheetId`. Extracting with `HttpContext` lets both Sheets and Drive transports share the same auth/retry/error infrastructure. `TransportContext extends HttpContext` is a non-breaking structural typing change.

**Breaking change risk**: None. `TransportContext` keeps the same shape. Existing tests pass without modification. New exports from `http.ts` don't affect existing imports.

**Alternatives considered**: Duplicating HTTP logic in `drive.ts`. Rejected — ~80 lines of identical retry/error code that could diverge. Merging Drive into `transport.ts`. Rejected — mixes two API domains in a 500+ line file.
