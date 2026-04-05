# API Contracts: Drive Workspace API

**Branch**: `004-drive-workspace-api` | **Date**: 2026-04-05

## Public API Surface

### resolveWorkspace(config)

```typescript
export async function resolveWorkspace(
  config: WorkspaceConfig,
): Promise<ResolvedWorkspace>;
```

**Input**: `WorkspaceConfig` — appId, folderName, defaultSpreadsheetName, auth
**Output**: `ResolvedWorkspace` — folderId, spreadsheetId, spreadsheets[], created
**Errors**: `AUTH_ERROR`, `PERMISSION_ERROR`, `RATE_LIMIT`, `NETWORK_ERROR`, `DRIVE_ERROR`, `VALIDATION_ERROR` (invalid config)

---

### createManagedClient(config)

```typescript
export async function createManagedClient<
  S extends Record<string, SheetSchema<any>>,
>(
  config: ManagedClientConfig<S>,
): Promise<{ client: GenjutsuClient<S>; workspace: ResolvedWorkspace }>;
```

**Input**: `ManagedClientConfig<S>` — workspace config + schemas
**Output**: `{ client, workspace }` — fully configured client + resolved workspace metadata
**Errors**: All `resolveWorkspace` errors + all `createClient` errors (SCHEMA_ERROR)

---

### findAppFolder(ctx, appId)

```typescript
export async function findAppFolder(
  ctx: DriveContext,
  appId: string,
): Promise<{ id: string; name: string } | null>;
```

**Drive API Call**:
```
GET https://www.googleapis.com/drive/v3/files
  ?q=mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='genjutsuApp' and value='<appId>' }
  &fields=files(id,name,modifiedTime)
  &orderBy=modifiedTime desc
  &pageSize=10
  &supportsAllDrives=true
  &includeItemsFromAllDrives=true
Headers: Authorization: Bearer <token>
```

**Returns**: Most recently modified matching folder, or `null`.

---

### createAppFolder(ctx, appId, folderName)

```typescript
export async function createAppFolder(
  ctx: DriveContext,
  appId: string,
  folderName: string,
): Promise<{ id: string; name: string }>;
```

**Drive API Call**:
```
POST https://www.googleapis.com/drive/v3/files
  ?supportsAllDrives=true
Headers: Authorization: Bearer <token>, Content-Type: application/json
Body:
{
  "name": "<folderName>",
  "mimeType": "application/vnd.google-apps.folder",
  "appProperties": {
    "genjutsuApp": "<appId>",
    "genjutsuType": "appFolder"
  }
}
```

**Returns**: `{ id, name }` of created folder.

---

### listSpreadsheetsInFolder(ctx, folderId)

```typescript
export async function listSpreadsheetsInFolder(
  ctx: DriveContext,
  folderId: string,
): Promise<Array<{ id: string; name: string }>>;
```

**Drive API Call**:
```
GET https://www.googleapis.com/drive/v3/files
  ?q='<folderId>' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false
  &fields=files(id,name,modifiedTime)
  &orderBy=modifiedTime desc
  &pageSize=100
  &supportsAllDrives=true
  &includeItemsFromAllDrives=true
Headers: Authorization: Bearer <token>
```

**Returns**: Array of spreadsheets sorted by most recently modified, or empty array.

---

### createSpreadsheetInFolder(ctx, folderId, title, appId)

```typescript
export async function createSpreadsheetInFolder(
  ctx: DriveContext,
  folderId: string,
  title: string,
  appId: string,
): Promise<{ id: string; name: string }>;
```

**Drive API Call**:
```
POST https://www.googleapis.com/drive/v3/files
  ?supportsAllDrives=true
Headers: Authorization: Bearer <token>, Content-Type: application/json
Body:
{
  "name": "<title>",
  "mimeType": "application/vnd.google-apps.spreadsheet",
  "parents": ["<folderId>"],
  "appProperties": {
    "genjutsuApp": "<appId>",
    "genjutsuType": "spreadsheet"
  }
}
```

**Returns**: `{ id, name }` where `id` is the spreadsheet ID usable with the Sheets v4 API.

---

## Internal API (http.ts)

### HttpContext

```typescript
export interface HttpContext {
  auth?: string | (() => Promise<string>);
  apiKey?: string;
}
```

### resolveToken(auth)

```typescript
export async function resolveToken(
  auth: string | (() => Promise<string>),
): Promise<string>;
```

### fetchWithErrorHandling(url, init, ctx, retryOn401?)

```typescript
export async function fetchWithErrorHandling(
  url: string,
  init: RequestInit,
  ctx: HttpContext,
  retryOn401?: boolean,
): Promise<Response>;
```

### buildAuthHeaders(ctx)

```typescript
export async function buildAuthHeaders(
  ctx: HttpContext,
): Promise<Record<string, string>>;
```

### Helper functions

```typescript
export function appendParams(url: string, extra: string): string;
export function parseRetryAfterMs(res: Response): number | undefined;
export function wrapHttpError(status: number, body: string, cause?: unknown): never;
```

---

## Error Contracts

| Scenario | Error Kind | Message Pattern |
|----------|-----------|-----------------|
| No auth provided to resolveWorkspace | VALIDATION_ERROR | "resolveWorkspace requires OAuth auth, not an API key" |
| Empty appId | VALIDATION_ERROR | "appId must be a non-empty string" |
| Drive API 401 | AUTH_ERROR | "Authentication failed: 401 ..." |
| Drive API 403 | PERMISSION_ERROR | "Permission denied: 403 ... (ensure drive.file scope)" |
| Drive API 429 | RATE_LIMIT | "Rate limited: 429 ..." (with retryAfterMs) |
| Drive API other error | DRIVE_ERROR | "Drive API error: {status} {body}" |
| Network failure | NETWORK_ERROR | "Network request failed: ..." |
| Folder creation failure | DRIVE_ERROR | "Failed to create workspace folder: ..." |
| Spreadsheet creation failure | DRIVE_ERROR | "Failed to create workspace spreadsheet: ..." |
