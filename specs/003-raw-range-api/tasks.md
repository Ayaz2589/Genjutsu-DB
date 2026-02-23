# Tasks: Raw Range API

**Input**: Design documents from `/specs/003-raw-range-api/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Add the `RawRangeApi` type and update the `GenjutsuClient` interface.

- [X] T001 Add `RawRangeApi` interface to `src/types.ts` — define `readRange(range: string, valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE"): Promise<unknown[][]>`, `writeRange(range: string, values: unknown[][]): Promise<void>`, `clearRange(range: string): Promise<void>`
- [X] T002 Add `raw: RawRangeApi` property to the `GenjutsuClient<S>` interface in `src/types.ts`
- [X] T003 Export `RawRangeApi` type from `src/index.ts`

**Checkpoint**: Types compile. No behavior changes yet.

---

## Phase 2: User Story 1 — Read and Write Arbitrary Cell Ranges (Priority: P1) 🎯 MVP

**Goal**: Expose `readRange`, `writeRange`, and `clearRange` on the client's `raw` namespace, delegating to internal transport functions with the same auth and write mutex.

**Independent Test**: Create a client, call `raw.readRange`, `raw.writeRange`, and `raw.clearRange` on non-model ranges and verify data round-trips through the same auth infrastructure.

- [X] T004 [US1] Implement the `raw` property in `createClient()` in `src/client.ts` — add a `raw: { readRange, writeRange, clearRange }` object to the returned client that delegates to the internal `getSheetValues`, `updateSheet`, and `clearRange` transport functions using the existing `ctx` (TransportContext)
- [X] T005 [US1] `raw.readRange` MUST call `getSheetValues(ctx, range, valueRenderOption)` and return the result directly — no write mutex needed
- [X] T006 [US1] `raw.writeRange` MUST call `assertWritable()` and use `withWriteLock` to serialize, then call `updateSheet(ctx, range, values, false)` (overwrite semantics, not append)
- [X] T007 [US1] `raw.clearRange` MUST call `assertWritable()` and use `withWriteLock` to serialize, then call `clearRange(ctx, range)`
- [X] T008 [US1] Add tests for `raw.readRange` in `test/raw-range.test.ts` — verify it returns cell values as `unknown[][]`, supports both `FORMATTED_VALUE` and `UNFORMATTED_VALUE` render options, and returns empty array for empty ranges
- [X] T009 [US1] Add tests for `raw.writeRange` in `test/raw-range.test.ts` — verify it writes values to the specified range with overwrite semantics
- [X] T010 [US1] Add tests for `raw.clearRange` in `test/raw-range.test.ts` — verify it clears the specified range
- [X] T011 [US1] Add test for read-only client in `test/raw-range.test.ts` — verify `raw.readRange` works with apiKey-only client, and `raw.writeRange`/`raw.clearRange` reject with permission error
- [X] T012 [US1] Run `bun test` — verify all existing tests pass plus new raw range tests
- [X] T013 [US1] Run `bun run build` — verify TypeScript strict mode passes

**Checkpoint**: Raw range API functional. All three methods work with same auth and error infrastructure as model operations.

---

## Phase 3: User Story 2 — Unified Error Handling (Priority: P2)

**Goal**: Verify that raw range methods produce the same structured error types as model operations for all failure modes.

**Independent Test**: Trigger auth failures, rate limits, and network errors on raw range calls and verify they produce `GenjutsuError` with correct `kind` values.

- [X] T014 [US2] Add test for auth error (401) on `raw.readRange` in `test/raw-range.test.ts` — verify it throws `GenjutsuError` with `kind: "AUTH_ERROR"`, same as model operations
- [X] T015 [US2] Add test for rate limit error (429) on `raw.readRange` in `test/raw-range.test.ts` — verify it throws `GenjutsuError` with `kind: "RATE_LIMIT"` and `retryAfterMs` if present
- [X] T016 [US2] Add test for network error on `raw.writeRange` in `test/raw-range.test.ts` — verify it throws `GenjutsuError` with `kind: "NETWORK_ERROR"`
- [X] T017 [US2] Add test for permission error (403) on `raw.clearRange` in `test/raw-range.test.ts` — verify it throws `GenjutsuError` with `kind: "PERMISSION_ERROR"`
- [X] T018 [US2] Run `bun test` — verify all tests pass
- [X] T019 [US2] Run `bun run build` — verify TypeScript strict mode passes

**Checkpoint**: All error types verified. Raw range methods produce identical structured errors to model operations.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and cleanup.

- [X] T020 Run `bun run lint` — verify no new lint errors introduced
- [X] T021 Verify existing model operation tests still pass — no regressions from adding `raw` to the client
- [X] T022 Verify the `raw` property appears in the exported `GenjutsuClient` type — consumers get autocomplete for `client.raw.readRange` etc.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US1)**: Depends on Phase 1 — types must exist before implementation
- **Phase 3 (US2)**: Depends on Phase 2 — error tests require working raw methods
- **Phase 4 (Polish)**: Depends on Phase 3

### User Story Dependencies

- **US1 (Read/Write Ranges)**: Depends on Setup (Phase 1). No dependency on US2.
- **US2 (Unified Errors)**: Depends on US1 — raw methods must work before testing error paths.

### Parallel Opportunities

- T001, T002, T003 are sequential (same file for T001/T002, then barrel update)
- T008, T009, T010, T011 could be written in parallel (different test describe blocks)
- T014, T015, T016, T017 could be written in parallel (different error scenarios)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: US1 (T004–T013)
3. **STOP and VALIDATE**: Raw range methods work with correct auth and mutex behavior
4. All existing model operations still work — zero regressions

### Incremental Delivery

1. Phase 1 → Types ready
2. Phase 2 (US1) → Raw range API functional → Validate round-trip works
3. Phase 3 (US2) → Error handling verified → All failure modes produce structured errors
4. Phase 4 → Final polish and lint

---

## Notes

- This feature adds ~30 lines of implementation code (3 one-liner delegations + mutex wrappers)
- No new dependencies — reuses existing internal transport functions
- Constitution Principle II (Zero Runtime Dependencies) preserved
- Constitution Principle V (Incremental Refactoring) followed: tests alongside implementation
- The `raw` namespace is intentionally minimal — no batch operations, no append, no formatting
