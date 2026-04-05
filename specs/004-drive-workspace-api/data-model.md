# Data Model: Drive Workspace API

**Branch**: `004-drive-workspace-api` | **Date**: 2026-04-05

## Entities

### HttpContext (internal, shared)

Base interface for HTTP operations across both Sheets and Drive transports.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| auth | `string \| (() => Promise<string>)` | No | OAuth token (static or async provider) |
| apiKey | `string` | No | API key for read-only Sheets access |

**Relationships**: Extended by `TransportContext` (Sheets) and `DriveContext` (Drive).

### DriveContext (internal)

Context for Drive v3 API operations. Requires OAuth — no API key support.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| auth | `string \| (() => Promise<string>)` | **Yes** | OAuth token (static or async provider) |

**Validation**: `auth` is mandatory. Drive API does not support API key access for private file operations.

**Relationships**: Subset of `HttpContext` with `auth` required.

### WorkspaceConfig (public input)

Configuration for `resolveWorkspace()`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| appId | `string` | **Yes** | — | Unique app identifier, stored in `appProperties.genjutsuApp` |
| folderName | `string` | No | `appId` value | Human-readable folder name shown in Drive |
| defaultSpreadsheetName | `string` | **Yes** | — | Name for the spreadsheet created on first run |
| auth | `string \| (() => Promise<string>)` | **Yes** | — | OAuth token or async provider |

**Validation**:
- `appId` must be non-empty string
- `defaultSpreadsheetName` must be non-empty string
- `auth` must be provided (not API key)

### ResolvedWorkspace (public output)

Result of `resolveWorkspace()`.

| Field | Type | Description |
|-------|------|-------------|
| folderId | `string` | Google Drive folder ID |
| spreadsheetId | `string` | Primary spreadsheet ID (most recently modified) |
| spreadsheets | `Array<{ id: string; name: string }>` | All spreadsheets in the folder |
| created | `boolean` | `true` if folder and/or spreadsheet were created |

### ManagedClientConfig (public input)

Configuration for `createManagedClient()`. Combines workspace + client config.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| appId | `string` | **Yes** | App identifier for workspace |
| folderName | `string` | No | Folder name in Drive |
| defaultSpreadsheetName | `string` | **Yes** | Default spreadsheet name |
| auth | `string \| (() => Promise<string>)` | **Yes** | OAuth token or provider |
| schemas | `S extends Record<string, SheetSchema<any>>` | **Yes** | Model schemas for `createClient` |

### DriveFile (internal)

Represents a file returned from Drive v3 API queries.

| Field | Type | Description |
|-------|------|-------------|
| id | `string` | Drive file ID |
| name | `string` | File name |
| modifiedTime | `string` (optional) | ISO timestamp of last modification |

## Error Kind Addition

### DRIVE_ERROR

Added to `GenjutsuErrorKind` union type.

| Property | Value |
|----------|-------|
| kind | `"DRIVE_ERROR"` |
| message | Descriptive error from Drive API |
| cause | Original error or response |

**Factory**: `driveError(message: string, cause?: unknown): GenjutsuError`

## appProperties Schema

### On App Folders

```json
{
  "genjutsuApp": "<appId>",
  "genjutsuType": "appFolder"
}
```

### On Spreadsheets

```json
{
  "genjutsuApp": "<appId>",
  "genjutsuType": "spreadsheet"
}
```

## State Transitions

### resolveWorkspace() Flow

```
START
  │
  ├─ Query Drive for folder with appProperties.genjutsuApp === appId
  │   ├─ FOUND → use existing folder
  │   └─ NOT FOUND → create folder with appProperties → FOLDER CREATED
  │
  ├─ List spreadsheets in folder (trashed=false)
  │   ├─ HAS SHEETS → select most recently modified as primary
  │   └─ EMPTY → create spreadsheet via Drive files.create with parents → SHEET CREATED
  │
  └─ RETURN ResolvedWorkspace
       created = (FOLDER CREATED || SHEET CREATED)
```
