# Tasks: Drive Workspace API

**Input**: Design documents from `/specs/004-drive-workspace-api/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/drive-api.md, quickstart.md

**Tests**: Tests are included — the project follows Constitution Principle V (incremental refactoring with tests first) and all public API functions must have tests per the Development Workflow.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Error system update and shared HTTP extraction — prerequisite infrastructure for all Drive work.

- [X] T001 Add `DRIVE_ERROR` kind to `GenjutsuErrorKind` union and add `driveError()` factory function in `src/errors.ts`
- [X] T002 Add test cases for `DRIVE_ERROR` kind and `driveError()` factory in `test/errors.test.ts`
- [X] T003 Create `src/http.ts` with `HttpContext` interface and extract `resolveToken`, `parseRetryAfterMs`, `wrapHttpError`, `buildAuthHeaders`, `appendParams`, `fetchWithErrorHandling` from `src/transport.ts`
- [X] T004 Create `test/http.test.ts` with tests for all extracted functions: resolveToken (static + async), fetchWithErrorHandling (success, 401 retry, 403, 429 with Retry-After, network error), buildAuthHeaders, appendParams, parseRetryAfterMs, wrapHttpError
- [X] T005 Refactor `src/transport.ts` to import shared functions from `src/http.ts` — make `TransportContext` extend `HttpContext`, remove moved function bodies, update internal call sites
- [X] T006 Run `bun test` to verify all existing tests pass after refactor (zero regressions in `test/transport.test.ts`, `test/client.test.ts`, `test/raw-range.test.ts`)

**Checkpoint**: Shared HTTP infrastructure ready. All existing tests pass. Drive work can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Drive v3 transport layer and type definitions that all user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 Add new types to `src/types.ts`: `DriveContext`, `WorkspaceConfig`, `ResolvedWorkspace`, `ManagedClientConfig<S>`, and `DriveFile` as defined in `specs/004-drive-workspace-api/data-model.md`
- [X] T008 Create `src/drive.ts` with `DRIVE_API` constant and implement `findAppFolder(ctx, appId)` — query Drive v3 `files.list` with `appProperties has { key='genjutsuApp' and value='<appId>' }`, `mimeType=folder`, `trashed=false`, `orderBy=modifiedTime desc`, `supportsAllDrives=true`, `includeItemsFromAllDrives=true`. Return most recently modified folder or null. Use `fetchWithErrorHandling` from `src/http.ts`.
- [X] T009 [P] Implement `createAppFolder(ctx, appId, folderName)` in `src/drive.ts` — POST to Drive v3 `files.create` with `mimeType=folder`, `appProperties: { genjutsuApp: appId, genjutsuType: "appFolder" }`, `supportsAllDrives=true`. Return `{ id, name }`.
- [X] T010 [P] Implement `listSpreadsheetsInFolder(ctx, folderId)` in `src/drive.ts` — query Drive v3 `files.list` with `'folderId' in parents`, `mimeType=spreadsheet`, `trashed=false`, `orderBy=modifiedTime desc`, `supportsAllDrives=true`, `includeItemsFromAllDrives=true`. Return array of `{ id, name }`.
- [X] T011 [P] Implement `createSpreadsheetInFolder(ctx, folderId, title, appId)` in `src/drive.ts` — POST to Drive v3 `files.create` with `mimeType=spreadsheet`, `parents: [folderId]`, `appProperties: { genjutsuApp: appId, genjutsuType: "spreadsheet" }`, `supportsAllDrives=true`. Return `{ id, name }`.
- [X] T012 Create `test/drive.test.ts` with mocked `globalThis.fetch` tests for all four Drive functions: findAppFolder (found, not found, multiple folders picks most recent), createAppFolder (success, error), listSpreadsheetsInFolder (has sheets, empty, error), createSpreadsheetInFolder (success, error). Test 401 retry behavior and error mapping (403→PERMISSION_ERROR, 429→RATE_LIMIT, other→DRIVE_ERROR).

**Checkpoint**: Drive transport layer complete and tested. Workspace orchestration can begin.

---

## Phase 3: User Story 1 - First-Time Setup: Automatic Workspace Creation (Priority: P1) 🎯 MVP

**Goal**: Consumer calls `resolveWorkspace()` and gets back a ready-to-use spreadsheet ID — folder and spreadsheet are automatically found or created.

**Independent Test**: Call `resolveWorkspace()` with mocked fetch returning empty search results, verify it creates folder + spreadsheet and returns `{ folderId, spreadsheetId, spreadsheets, created: true }`. Call again with mocked existing folder + sheet, verify it returns `created: false`.

### Tests for User Story 1

- [X] T013 [US1] Create `test/workspace.test.ts` with mocked fetch tests for `resolveWorkspace()`: first-time setup (no folder → creates folder → creates spreadsheet → returns created: true), returning user (folder + sheet exist → returns created: false), folder exists but empty (creates spreadsheet), validation errors (missing auth, empty appId, empty defaultSpreadsheetName), default folderName falls back to appId

### Implementation for User Story 1

- [X] T014 [US1] Create `src/workspace.ts` and implement `resolveWorkspace(config)`: validate config (auth required, appId non-empty, defaultSpreadsheetName non-empty), call `findAppFolder` → if null call `createAppFolder` → call `listSpreadsheetsInFolder` → if empty call `createSpreadsheetInFolder` ��� return `ResolvedWorkspace` with folderId, spreadsheetId (first sheet's id), spreadsheets array, created flag
- [X] T015 [US1] Export `resolveWorkspace`, `WorkspaceConfig`, `ResolvedWorkspace`, `DriveContext`, and all four Drive functions (`findAppFolder`, `createAppFolder`, `listSpreadsheetsInFolder`, `createSpreadsheetInFolder`) from `src/index.ts`
- [X] T016 [US1] Run `bun test` to verify workspace tests pass and all existing tests still pass

**Checkpoint**: `resolveWorkspace()` is functional. A consumer can find or create a workspace with a single call. MVP is deliverable.

---

## Phase 4: User Story 2 - Isolation from Personal Files (Priority: P1)

**Goal**: Verify that workspace resolution never interferes with user's personal files — isolation is guaranteed by `appProperties` query, not naming.

**Independent Test**: Mock Drive API returning both a tagged folder and an untagged folder with the same name. Verify only the tagged folder is selected.

### Tests for User Story 2

- [X] T017 [US2] Add isolation test cases to `test/workspace.test.ts`: user has personal folder with same name (only tagged folder selected), user renames tagged folder (still found by appProperties), multiple tagged folders with same appId (most recently modified selected)

### Implementation for User Story 2

- [X] T018 [US2] Verify `findAppFolder` in `src/drive.ts` already handles isolation correctly — the `appProperties` query filter excludes untagged folders by design. No code changes expected; this phase validates the existing implementation via new test cases.
- [X] T019 [US2] Run `bun test` to verify all isolation tests pass

**Checkpoint**: Isolation from personal files is verified through tests. appProperties-based identification confirmed working.

---

## Phase 5: User Story 3 - Multiple Spreadsheets in a Workspace (Priority: P2)

**Goal**: `resolveWorkspace()` returns all spreadsheets in the folder, enabling multi-spreadsheet selection by the consumer.

**Independent Test**: Mock Drive API returning a folder with 3 spreadsheets. Verify `spreadsheets` array contains all 3 and `spreadsheetId` is the most recently modified.

### Tests for User Story 3

- [X] T020 [US3] Add multi-spreadsheet test cases to `test/workspace.test.ts`: folder with 3 spreadsheets (returns all in spreadsheets array, spreadsheetId is first/most recent), createSpreadsheetInFolder used directly by consumer to add spreadsheet to existing folder

### Implementation for User Story 3

- [X] T021 [US3] Verify `resolveWorkspace` in `src/workspace.ts` already returns full spreadsheets array from `listSpreadsheetsInFolder`. No code changes expected if Phase 3 implementation correctly passes through all results.
- [X] T022 [US3] Run `bun test` to verify multi-spreadsheet tests pass

**Checkpoint**: Multi-spreadsheet workspace support verified. Consumers can list and select from multiple spreadsheets.

---

## Phase 6: User Story 4 - Convenience Client Creation (Priority: P3)

**Goal**: `createManagedClient()` combines workspace resolution with client creation in a single call.

**Independent Test**: Call `createManagedClient()` with mocked fetch, verify it returns both a functional `GenjutsuClient` and workspace metadata.

### Tests for User Story 4

- [X] T023 [US4] Create `test/managed.test.ts` with mocked fetch tests for `createManagedClient()`: returns `{ client, workspace }`, client has working `repo()` method, workspace has correct metadata, schemas are validated, auth is required

### Implementation for User Story 4

- [X] T024 [US4] Create `src/managed.ts` and implement `createManagedClient<S>(config)`: call `resolveWorkspace()` with workspace fields, then call `createClient()` with `{ spreadsheetId: workspace.spreadsheetId, auth: config.auth, schemas: config.schemas }`, return `{ client, workspace }`
- [X] T025 [US4] Export `createManagedClient` and `ManagedClientConfig` from `src/index.ts`
- [X] T026 [US4] Run `bun test` to verify managed client tests pass and all existing tests still pass

**Checkpoint**: Full convenience API available. Both composable (`resolveWorkspace` + `createClient`) and all-in-one (`createManagedClient`) patterns work.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, type-checking, and build verification.

- [X] T027 Run `bun run build` to verify TypeScript compilation succeeds with all new modules
- [X] T028 Run `bun run lint` to verify no lint errors in new files
- [X] T029 Verify all public exports from `src/index.ts` are correct: `resolveWorkspace`, `createManagedClient`, `findAppFolder`, `createAppFolder`, `listSpreadsheetsInFolder`, `createSpreadsheetInFolder`, `driveError`, `WorkspaceConfig`, `ResolvedWorkspace`, `ManagedClientConfig`, `DriveContext`, `HttpContext`
- [X] T030 Run full test suite `bun test` — all tests (existing + new) must pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion (needs `DRIVE_ERROR` + `http.ts` + types)
- **User Story 1 (Phase 3)**: Depends on Phase 2 (needs Drive transport functions)
- **User Story 2 (Phase 4)**: Depends on Phase 3 (validates isolation of existing implementation)
- **User Story 3 (Phase 5)**: Depends on Phase 3 (validates multi-spreadsheet of existing implementation)
- **User Story 4 (Phase 6)**: Depends on Phase 3 (needs `resolveWorkspace` + existing `createClient`)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on Foundational phase — core workspace implementation
- **User Story 2 (P1)**: Depends on US1 — validates isolation via additional tests
- **User Story 3 (P2)**: Depends on US1 — validates multi-spreadsheet via additional tests
- **User Story 4 (P3)**: Depends on US1 — new module wrapping `resolveWorkspace` + `createClient`

### Within Each Phase

- Tests written FIRST, then implementation
- Models/types before functions
- Core functions before orchestrators
- Run `bun test` at each checkpoint

### Parallel Opportunities

- **Phase 1**: T001 + T002 can run in parallel (errors.ts changes + tests)
- **Phase 2**: T009, T010, T011 can run in parallel after T008 (independent Drive functions in same file)
- **Phase 4-5**: US2 and US3 can run in parallel after US1 (independent test additions)
- **Phase 6**: US4 can start as soon as US1 is complete (independent new module)

---

## Parallel Example: Phase 2 (Foundational)

```bash
# After T008 (findAppFolder) is done, launch remaining Drive functions together:
Task: "T009 — Implement createAppFolder in src/drive.ts"
Task: "T010 — Implement listSpreadsheetsInFolder in src/drive.ts"
Task: "T011 — Implement createSpreadsheetInFolder in src/drive.ts"
```

## Parallel Example: After User Story 1

```bash
# US2, US3, US4 can all start once US1 is complete:
Task: "T017 — Isolation tests in test/workspace.test.ts"
Task: "T020 — Multi-spreadsheet tests in test/workspace.test.ts"
Task: "T023 — Managed client tests in test/managed.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (error kind + HTTP extraction + refactor)
2. Complete Phase 2: Foundational (Drive transport + types)
3. Complete Phase 3: User Story 1 (`resolveWorkspace`)
4. **STOP and VALIDATE**: Test workspace creation independently
5. This is a usable, shippable increment

### Incremental Delivery

1. Setup + Foundational → Shared infrastructure ready
2. Add User Story 1 → `resolveWorkspace()` works → **MVP!**
3. Add User Story 2 → Isolation verified via tests
4. Add User Story 3 → Multi-spreadsheet verified via tests
5. Add User Story 4 → `createManagedClient()` convenience added
6. Polish → Build, lint, full validation

### Key Risk: HTTP Extraction (Phase 1)

The `src/http.ts` extraction (T003-T006) is the highest-risk task — it refactors existing working code. Mitigation: run full existing test suite after refactor to catch any regression. The extraction is structurally safe (TypeScript structural typing ensures `TransportContext extends HttpContext` is non-breaking).

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently testable after its phase completes
- Commit after each task or logical group
- Stop at any checkpoint to validate independently
- Constitution Principle V: tests first, then implementation, then `bun test`
- Constitution Principle II: zero runtime dependencies — Drive API via native `fetch` only
