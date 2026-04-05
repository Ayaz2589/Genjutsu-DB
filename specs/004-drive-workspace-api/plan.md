# Implementation Plan: Drive Workspace API

**Branch**: `004-drive-workspace-api` | **Date**: 2026-04-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-drive-workspace-api/spec.md`

## Summary

Add Google Drive v3 integration to genjutsu-db so consuming apps can automatically find or create an isolated workspace (folder + spreadsheet) in the user's Drive. Uses `appProperties` metadata for collision-proof identification. Exposes `resolveWorkspace()` as the primary API and `createManagedClient()` as a convenience wrapper. Requires extracting shared HTTP logic from the existing Sheets transport to avoid duplication.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: None (zero runtime deps — Constitution Principle II)
**Storage**: Google Sheets v4 REST API + Google Drive v3 REST API via native `fetch`
**Testing**: Bun test runner, tests in `test/` mirroring `src/`
**Target Platform**: Browser/Node ESM (client-side library)
**Project Type**: Single library package
**Performance Goals**: N/A — delegates to Google APIs, no local computation
**Constraints**: Zero runtime dependencies, no `@ts-ignore`/`any` without justification
**Scale/Scope**: 4 new modules (~400-500 lines), 1 refactored module, 1 modified module

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero Domain Knowledge | PASS | Workspace API is fully generic — `appId`, `folderName`, `spreadsheetName` are consumer-provided strings. No domain concepts. |
| II. Zero Runtime Dependencies | PASS | Drive v3 communication via native `fetch`. No new dependencies. Shared HTTP extracted internally. |
| III. Type Safety Without Codegen | PASS | `WorkspaceConfig`, `ResolvedWorkspace`, `ManagedClientConfig` are standard TypeScript interfaces. `createManagedClient` preserves full generic inference from schemas. |
| IV. Simplicity | PASS | `resolveWorkspace` is a ~50-line orchestrator over 4 low-level functions. `createManagedClient` is a thin wrapper. HTTP extraction is justified by DRY (same auth/retry/error logic). See Complexity Tracking. |
| V. Incremental Refactoring | PASS | HTTP refactor first (with existing tests green), then new modules with their own tests. |

## Project Structure

### Documentation (this feature)

```text
specs/004-drive-workspace-api/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── http.ts          # NEW — shared HTTP fetch: resolveToken, authedFetch, error wrapping
├── drive.ts         # NEW — Drive v3 API: findAppFolder, createAppFolder, listSpreadsheetsInFolder, createSpreadsheetInFolder
├── workspace.ts     # NEW — resolveWorkspace() orchestrator
├── managed.ts       # NEW — createManagedClient() convenience factory
├── transport.ts     # MODIFIED — import shared logic from http.ts (internal refactor, no public API change)
├── errors.ts        # MODIFIED — add DRIVE_ERROR kind + driveError() factory
├── types.ts         # MODIFIED — add WorkspaceConfig, ResolvedWorkspace, ManagedClientConfig, DriveContext types
├── index.ts         # MODIFIED — export new public API surface
├── client.ts        # UNCHANGED
├── model.ts         # UNCHANGED
├── relations.ts     # UNCHANGED
├── migrations.ts    # UNCHANGED
└── utils.ts         # UNCHANGED

test/
├── http.test.ts         # NEW — tests for extracted shared HTTP logic
├── drive.test.ts        # NEW — tests for Drive v3 API functions (mocked fetch)
├── workspace.test.ts    # NEW — tests for resolveWorkspace edge cases
├── managed.test.ts      # NEW — tests for createManagedClient
├── transport.test.ts    # EXISTING — must pass after refactor (regression check)
├── client.test.ts       # EXISTING — must pass (no changes)
├── model.test.ts        # EXISTING — must pass (no changes)
├── relations.test.ts    # EXISTING — must pass (no changes)
├── migrations.test.ts   # EXISTING — must pass (no changes)
├── errors.test.ts       # EXISTING — updated for DRIVE_ERROR
├── raw-range.test.ts    # EXISTING — must pass (no changes)
└── utils.test.ts        # EXISTING — must pass (no changes)
```

**Structure Decision**: Single library project. Four new source files for clean separation of concerns (HTTP, Drive transport, workspace orchestration, managed client). One internal refactor of `transport.ts` to extract shared HTTP logic. No structural changes to existing modules.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|-------------------------------------|
| `src/http.ts` (shared HTTP) | `transport.ts` and `drive.ts` both need auth resolution, 401 retry, and error wrapping. Without extraction, ~80 lines of logic would be duplicated. | Duplicating the code: violates DRY, risks divergent error handling between Sheets and Drive APIs. Putting Drive code in `transport.ts`: file is already 329 lines and Drive is a different API domain. |
| `src/drive.ts` (Drive transport) | Drive v3 is a separate API from Sheets v4 with different endpoints, query patterns, and response shapes. Mixing them in `transport.ts` would conflate two concerns. | Adding to `transport.ts`: would make it ~500+ lines mixing two API domains. Adding to `workspace.ts`: would mix low-level HTTP with orchestration logic. |
| `src/workspace.ts` (orchestrator) | Separates the high-level find-or-create flow from low-level Drive API calls. Consumers who need custom flows import from `drive.ts`; standard flows use `workspace.ts`. | Putting orchestration in `drive.ts`: mixes abstraction levels. Putting it in `managed.ts`: managed client is optional sugar, workspace resolution is the core primitive. |
| `src/managed.ts` (convenience) | Optional thin wrapper (~20 lines). Prevents `resolveWorkspace` + `createClient` boilerplate for the common case. | Not creating it: consumers write the same 5-line pattern every time. Adding to `client.ts`: forces Drive import on all client users. |
