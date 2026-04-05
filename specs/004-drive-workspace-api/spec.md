# Feature Specification: Drive Workspace API

**Feature Branch**: `004-drive-workspace-api`
**Created**: 2026-04-05
**Status**: Draft
**Input**: User description: "Add Google Drive folder and sheet management to genjutsu-db so that applications can automatically find or create an isolated workspace (folder + spreadsheet) in the user's Google Drive without interfering with their personal files. Use Drive v3 appProperties metadata for reliable identification."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-Time Setup: Automatic Workspace Creation (Priority: P1)

A developer builds an app using genjutsu-db. When their end user signs in for the first time, the app calls `resolveWorkspace()` with an `appId` and folder/sheet names. The library searches the user's Google Drive for a folder tagged with `appProperties.genjutsuApp === appId`. Finding none, it creates the folder, creates a default spreadsheet inside it, tags both with `appProperties`, and returns the spreadsheet ID — ready for `createClient()`. The end user sees a normal-looking folder in their Drive (e.g., "Budget") with no developer-facing naming conventions.

**Why this priority**: Without automatic workspace creation, every consuming app must implement its own Drive folder/sheet discovery logic — the exact duplication genjutsu-db exists to eliminate.

**Independent Test**: Can be tested by mocking Drive v3 API responses (empty file list for search, successful create for folder and spreadsheet, successful move) and verifying the correct sequence of API calls and returned workspace object.

**Acceptance Scenarios**:

1. **Given** no folder tagged with the app's `appId` exists in the user's Drive, **When** the app calls `resolveWorkspace({ appId: "budget", folderName: "Budget", defaultSpreadsheetName: "Budget Data", auth })`, **Then** the library creates a folder named "Budget" with `appProperties: { genjutsuApp: "budget", genjutsuType: "appFolder" }`, creates a spreadsheet named "Budget Data" inside it with `appProperties: { genjutsuApp: "budget", genjutsuType: "spreadsheet" }`, and returns `{ folderId, spreadsheetId, spreadsheets: [...], created: true }`.
2. **Given** a folder tagged with `appId: "budget"` already exists containing one spreadsheet, **When** the app calls `resolveWorkspace()` with the same `appId`, **Then** the library returns the existing folder and spreadsheet IDs with `created: false`.
3. **Given** a folder tagged with `appId: "budget"` exists but contains no spreadsheets (user trashed them), **When** the app calls `resolveWorkspace()`, **Then** the library creates a new default spreadsheet inside the existing folder.

---

### User Story 2 - Isolation from Personal Files (Priority: P1)

A user has their own folder named "Budget" in Google Drive for personal spreadsheets. An app using genjutsu-db also creates a workspace folder named "Budget". The two folders coexist without interference because the library identifies its folder by `appProperties` metadata (private to the OAuth client ID), not by name.

**Why this priority**: If the library collides with user files, it breaks trust and can corrupt personal data. Isolation is a hard requirement.

**Independent Test**: Can be tested by mocking Drive API to return two folders named "Budget" — one with `appProperties.genjutsuApp: "budget"` and one without — and verifying only the tagged folder is selected.

**Acceptance Scenarios**:

1. **Given** the user has a personal folder named "Budget" (no `appProperties`) AND the app's tagged folder also named "Budget", **When** the app calls `resolveWorkspace({ appId: "budget" })`, **Then** the library selects only the folder with matching `appProperties`, ignoring the personal one.
2. **Given** the user renames the app's folder from "Budget" to "My Finances", **When** the app calls `resolveWorkspace()`, **Then** the library still finds it because the query is by `appProperties`, not name.
3. **Given** two different apps (different OAuth client IDs) both use genjutsu-db with `appId: "tracker"`, **When** each app calls `resolveWorkspace()`, **Then** each finds only its own folder because `appProperties` are scoped per OAuth client ID.

---

### User Story 3 - Multiple Spreadsheets in a Workspace (Priority: P2)

A developer's app needs the user to manage multiple spreadsheets (e.g., one per project, one per year). The app calls `resolveWorkspace()` which returns all spreadsheets in the workspace folder. The app can then let the user pick which spreadsheet to connect to, or create a new one using the Drive API functions exposed by the library.

**Why this priority**: Many real-world apps need multi-spreadsheet support, but the core single-spreadsheet flow must work first.

**Independent Test**: Can be tested by mocking Drive API to return a folder with multiple spreadsheets and verifying the `spreadsheets` array in the result.

**Acceptance Scenarios**:

1. **Given** a workspace folder containing 3 spreadsheets, **When** the app calls `resolveWorkspace()`, **Then** the result includes all 3 in the `spreadsheets` array, and `spreadsheetId` is set to the most recently modified one.
2. **Given** a resolved workspace, **When** the app calls `createSpreadsheetInFolder(auth, folderId, "Project X")`, **Then** a new tagged spreadsheet is created inside the workspace folder.

---

### User Story 4 - Convenience Client Creation (Priority: P3)

A developer wants a single call that resolves the workspace AND creates the genjutsu-db client. `createManagedClient()` combines `resolveWorkspace()` + `createClient()` and returns both the client and workspace metadata.

**Why this priority**: Quality-of-life improvement. The composable two-step approach (Story 1) is the primary API.

**Independent Test**: Can be tested by verifying `createManagedClient()` calls `resolveWorkspace()` then `createClient()` with the resolved `spreadsheetId`.

**Acceptance Scenarios**:

1. **Given** valid workspace config and schemas, **When** the app calls `createManagedClient({ appId, folderName, defaultSpreadsheetName, auth, schemas })`, **Then** it returns `{ client, workspace }` where client is a fully functional `GenjutsuClient` and workspace contains the resolved metadata.

---

### Edge Cases

- What happens when the user's Drive has multiple folders with the same `appProperties.genjutsuApp` value? The library uses the most recently modified folder (ordered by `modifiedTime desc`).
- What happens when the workspace folder is trashed? The Drive query includes `trashed=false`, so the trashed folder is not found and a new one is created.
- What happens when the spreadsheet inside the folder is trashed? The listing query includes `trashed=false`, so a new default spreadsheet is created.
- What happens when the user moves the app's spreadsheet out of the folder? The listing returns empty, and a new default spreadsheet is created in the folder. The moved spreadsheet remains accessible if the app cached its ID.
- What happens when the OAuth scope is insufficient (no `drive.file`)? The Drive API returns 403, and the library throws a `PERMISSION_ERROR` with a descriptive message.
- What happens during a network failure mid-creation? Standard `GenjutsuError` propagation. Drive folder/file creation is atomic per API call — no partial state cleanup needed.
- What happens if `auth` is an API key instead of OAuth? `resolveWorkspace` requires OAuth (Drive API does not support API keys for private files). The library throws an `AUTH_ERROR` if no OAuth auth is provided.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The library MUST expose a `resolveWorkspace` function that finds or creates an app-specific folder and spreadsheet in Google Drive.
- **FR-002**: Folder and spreadsheet identification MUST use Google Drive `appProperties` metadata, NOT file names, to prevent collisions with user files.
- **FR-003**: The `appProperties` MUST include `genjutsuApp` (the app identifier) and `genjutsuType` (`"appFolder"` or `"spreadsheet"`) on all created files.
- **FR-004**: All Drive queries MUST include `trashed=false` to exclude deleted files.
- **FR-005**: When multiple folders match the `appProperties` query, the library MUST select the most recently modified one.
- **FR-006**: The library MUST expose low-level Drive functions (`findAppFolder`, `createAppFolder`, `listSpreadsheetsInFolder`, `createSpreadsheetInFolder`) for consumers that need custom workspace flows.
- **FR-007**: All Drive operations MUST use the same auth pattern (static token or async provider) and error handling (401 retry, typed errors) as existing Sheets operations.
- **FR-008**: The library MUST expose a `createManagedClient` convenience function that combines workspace resolution with client creation.
- **FR-009**: `resolveWorkspace` MUST require OAuth auth (not API key) since Drive operations require user authorization.
- **FR-010**: The shared HTTP logic (auth resolution, 401 retry, error wrapping) MUST be extracted into an internal module to avoid duplication between Sheets and Drive transports.

### Key Entities

- **Workspace**: A resolved Drive folder + spreadsheet(s) identified by `appId`. Contains `folderId`, `spreadsheetId`, `spreadsheets[]`, and `created` flag.
- **App Folder**: A Google Drive folder tagged with `appProperties: { genjutsuApp: "<appId>", genjutsuType: "appFolder" }`.
- **Workspace Spreadsheet**: A Google Sheets spreadsheet inside the app folder, tagged with `appProperties: { genjutsuApp: "<appId>", genjutsuType: "spreadsheet" }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Consumers can resolve a workspace (find or create folder + spreadsheet) with a single function call — no manual Drive API interaction required.
- **SC-002**: App-created files never collide with or interfere with the user's existing Google Drive files.
- **SC-003**: The workspace resolution is self-healing: trashed folders/sheets are automatically recreated on the next call.
- **SC-004**: Existing Sheets-only operations (`createClient`, model CRUD, migrations, raw range) continue to work identically — zero regressions.
- **SC-005**: The feature adds no runtime dependencies to the library.
- **SC-006**: The budget-tool app can replace its custom `googleDrive.ts` with genjutsu-db's built-in workspace API.

## Assumptions

- `appProperties` are scoped per OAuth client ID by the Google Drive API. Different apps (different OAuth clients) cannot see each other's `appProperties` even on the same file.
- The minimum required OAuth scope is `https://www.googleapis.com/auth/drive.file`, which grants access only to files created or opened by the app.
- Spreadsheet creation uses the Sheets API (for proper structure), then the file is moved into the workspace folder via the Drive API.
- The `resolveWorkspace` function is stateless — it queries Drive every time. Caching the workspace result is the consumer's responsibility.
- The `folderName` defaults to the `appId` if not provided.
- The primary spreadsheet returned is the most recently modified one in the folder.

## Scope Boundaries

**In scope**:
- `resolveWorkspace()` orchestrator function
- Low-level Drive functions: `findAppFolder`, `createAppFolder`, `listSpreadsheetsInFolder`, `createSpreadsheetInFolder`
- `createManagedClient()` convenience factory
- Internal HTTP refactor to share auth/retry/error logic between Sheets and Drive transports
- `DRIVE_ERROR` error kind addition
- Drive transport module (`src/drive.ts`)
- Workspace orchestrator module (`src/workspace.ts`)

**Out of scope**:
- Local caching or persistence of workspace IDs (consumer responsibility)
- Folder/file deletion or cleanup operations
- Sharing or permissions management on workspace files
- UI components for folder/sheet selection (consumer responsibility)
- Batch workspace operations (multiple apps in one call)
- Migration of existing non-tagged folders to the `appProperties` system
