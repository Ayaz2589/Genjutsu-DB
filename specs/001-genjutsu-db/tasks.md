# Tasks: genjutsu-db

**Input**: Design documents from `/specs/001-genjutsu-db/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Tests follow incremental refactoring discipline (Constitution Principle V). Each implementation task should have corresponding tests written first.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single library package**: `src/` and `test/` at repository root
- Source files: `src/*.ts`
- Test files: `test/*.test.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Initialize standalone library project with build tooling, TypeScript config, and directory structure

- [x] T001 Create `package.json` with name `genjutsu-db`, version `0.1.0`, type `module`, zero dependencies, dev dependencies (typescript, @types/bun), and scripts (test, build, lint) in `/package.json`
- [x] T002 Create `tsconfig.json` with strict mode, ESM module, target ES2022, declaration output, path alias `@/` → `src/`, and include `src/` in `/tsconfig.json`
- [x] T003 [P] Create `tsconfig.build.json` extending `tsconfig.json` that excludes `test/` and outputs to `dist/` in `/tsconfig.build.json`
- [x] T004 [P] Create `src/` and `test/` directory structure with placeholder `src/index.ts` exporting empty object

**Checkpoint**: `bun install` succeeds, `bun run build` produces empty output, project compiles

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extract and adapt core modules from budget-tool's `sheets-db` that ALL user stories depend on

**Source**: Copy from `/Users/ayazuddin/Development/personal/Web/budget-tool/src/lib/sheets-db/`

- [x] T005 Copy and adapt `src/errors.ts`: rename `SheetsDbError` → `GenjutsuError`, rename `isSheetsDbError` → `isGenjutsuError`, add `PERMISSION_ERROR` (403) and `MIGRATION_ERROR` error kinds, add `permissionError()` and `migrationError()` factory functions with `migrationVersion` and `migrationName` fields, keep deprecated `SheetsDbError` alias for backward compat
- [x] T006 [P] Copy and adapt `src/types.ts`: add `ClientConfig<S>` with `auth: string | (() => Promise<string>)` and `apiKey?: string`, add `primaryKey`, `fields`, and `relations` optional fields to `SheetSchema<T>`, add `FindOptions`, `ReadOptions`, `WriteOptions` interfaces, extend `Repository<T>` with `create`, `findById`, `findMany`, `update`, `delete` method signatures per contracts/api.md
- [x] T007 [P] Copy `src/utils.ts` unchanged from budget-tool (already generic — generateId, isValidDate, normalizeDate, parseAmount, findMissingHeaders, hasIdColumn, looksLikeIsoDate)
- [x] T008 Copy and adapt `src/transport.ts`: refactor to accept token as `string | (() => Promise<string>)` via a `resolveToken()` helper, add 401 retry logic (call provider once, retry request once, throw AUTH_ERROR on second 401), add 403 → `PERMISSION_ERROR` handling, add `apiKey` query parameter support for public sheet reads, add `createSpreadsheet()` function (POST to spreadsheets endpoint), add `batchGetValues()` function for multi-range reads, add `insertDimension()`, `deleteDimension()`, `updateCells()` transport wrappers for migrations
- [x] T009 Copy and adapt `src/client.ts`: update `createSheetsClient` → `createClient`, update config to use `ClientConfig<S>`, integrate token provider into transport context, block writes when only `apiKey` is provided (throw PERMISSION_ERROR), preserve write mutex, ensureSchema, applyFormatting, batchSync, add `migrate()` method stub (delegates to migrations module), add `_genjutsu_migrations` reserved name validation
- [x] T010 Update `src/index.ts` barrel export with all foundational modules (GenjutsuError, types, utils, transport, client) per contracts/api.md section 10

**Checkpoint**: `bun run build` compiles all foundational modules. Library can create a client with static token and perform readAll/writeAll/append/batchSync against a Google Sheet.

---

## Phase 3: User Story 1 — Library Extraction and Connection Model (Priority: P1) 🎯 MVP

**Goal**: Standalone installable package with token provider pattern, public sheet support, createSpreadsheet utility, and zero domain-specific code

**Independent Test**: Install library in a fresh project, create connection with token provider, read/write to a Google Sheet without any domain-specific code in the library

### Tests for User Story 1

- [x] T011 [P] [US1] Write tests for GenjutsuError creation, all 8 error kinds, `isGenjutsuError` type guard, and deprecated `SheetsDbError` alias in `test/errors.test.ts`
- [x] T012 [P] [US1] Write tests for utility functions (generateId, isValidDate, normalizeDate, parseAmount, findMissingHeaders) in `test/utils.test.ts`
- [x] T013 [P] [US1] Write tests for transport layer with mocked fetch: static token auth, async token provider, 401 retry with fresh token, 403 → PERMISSION_ERROR, 429 → RATE_LIMIT with retryAfterMs, network error handling, apiKey query parameter for reads, `extractSpreadsheetId` URL parsing, `createSpreadsheet` POST call in `test/transport.test.ts`
- [x] T014 [US1] Write tests for client factory: valid config creation, schema validation (empty sheetName, duplicate sheetNames, reserved `_genjutsu_migrations` name, empty headers), repo accessor returns typed repository, batchSync clear+write sequence, ensureSchema creates missing sheets, applyFormatting sends repeatCell requests, write-blocking when apiKey-only (PERMISSION_ERROR) in `test/client.test.ts`

### Implementation for User Story 1

- [x] T015 [US1] Implement and verify `src/errors.ts` passes all tests from T011
- [x] T016 [P] [US1] Implement and verify `src/utils.ts` passes all tests from T012
- [x] T017 [US1] Implement and verify `src/transport.ts` passes all tests from T013 — token provider resolution, 401 retry, 403 handling, apiKey support, createSpreadsheet, batchGetValues, structural operation wrappers
- [x] T018 [US1] Implement and verify `src/client.ts` passes all tests from T014 — createClient factory, write mutex, repo builder, batchSync, ensureSchema, applyFormatting, write-blocking for apiKey
- [x] T019 [US1] Verify zero domain-specific references: scan all `src/` files for budget/finance/ortho terms (expense, income, debt, mortgage, budget, owner, preset, totals) — must find zero matches
- [x] T020 [US1] Update `src/index.ts` to export complete US1 public API surface

**Checkpoint**: US1 complete. Library installs, connects with static token or async provider, handles 401/403/429, supports public sheets via apiKey, creates spreadsheets, and performs readAll/writeAll/append/batchSync. All tests pass.

---

## Phase 4: User Story 2 — Full CRUD and defineModel API (Priority: P1)

**Goal**: `defineModel()` with field builder generates typed schemas automatically. Full CRUD per model (create, findById, findMany, update, delete) alongside existing bulk operations.

**Independent Test**: Define a "Contact" model with `defineModel()`, create/findById/findMany/update/delete records, verify round-trip correctness

### Tests for User Story 2

- [x] T021 [P] [US2] Write tests for field builder in `test/model.test.ts`: `field.string()`, `field.number()`, `field.date()`, `field.boolean()` return correct FieldDef types, `.primaryKey()` marks isPrimaryKey, `.optional()` marks isOptional, `.default(value)` stores defaultValue, `.references(model, field)` stores FK reference
- [x] T022 [P] [US2] Write tests for `defineModel()` in `test/model.test.ts`: generates correct headers from field names, generates correct readRange/writeRange/clearRange from sheetName and field count, auto-generates parseRow that deserializes row to typed entity (string→string, number→number, date→string, boolean→boolean), auto-generates toRow that serializes entity to row array, generates validate function that checks required fields and types, sets primaryKey field name on schema, rejects zero fields (SCHEMA_ERROR), rejects multiple primaryKey fields (SCHEMA_ERROR), rejects no primaryKey field (SCHEMA_ERROR)
- [x] T023 [US2] Write tests for CRUD operations in `test/client.test.ts` (extend existing): `create()` appends record and returns it with defaults applied, `create()` rejects duplicate primary key (VALIDATION_ERROR), `findById()` returns matching record or null, `findMany()` with filter returns filtered results, `findMany()` without filter returns all records, `update()` merges partial changes and writes back full dataset, `update()` throws VALIDATION_ERROR if record not found, `delete()` removes record and rewrites remaining, `delete()` is no-op if ID not found, `readAll()`/`writeAll()`/`append()` still work alongside CRUD, raw `SheetSchema<T>` with manual parseRow/toRow works without defineModel

### Implementation for User Story 2

- [x] T024 [US2] Implement `src/model.ts`: `field` builder namespace with `string()`, `number()`, `date()`, `boolean()` methods returning `FieldDef<T>` with chainable `.primaryKey()`, `.optional()`, `.default()`, `.references()` — verify tests from T021 pass
- [x] T025 [US2] Implement `defineModel()` function in `src/model.ts`: accepts sheetName and fields record, generates `SheetSchema<InferModelType<F>>` with auto-generated headers, ranges, parseRow, toRow, validate, primaryKey — verify tests from T022 pass
- [x] T026 [US2] Implement CRUD operations in `src/client.ts`: extend repository builder to add `create()`, `findById()`, `findMany()`, `update()`, `delete()` per contracts/api.md — each uses readAll internally, all writes go through write mutex — verify tests from T023 pass
- [x] T027 [US2] Update `src/index.ts` to export `defineModel`, `field`, `FieldDef`, and all new types from `src/model.ts`

**Checkpoint**: US2 complete. Developers can define typed models with `defineModel()`, get full CRUD repositories with type inference, and use raw `SheetSchema<T>` for manual control. All tests pass.

---

## Phase 5: User Story 3 — Relations and Referential Integrity (Priority: P2)

**Goal**: FK validation on write rejects invalid references. Eager loading via `include` fetches related records in a single batchGet call.

**Independent Test**: Define Order + OrderItem models with FK, create order, create items referencing it, verify FK validation rejects invalid order ID, verify eager loading attaches items to orders

### Tests for User Story 3

- [x] T028 [P] [US3] Write tests for FK validation in `test/relations.test.ts`: `create()` with valid FK succeeds, `create()` with invalid FK throws VALIDATION_ERROR with field name and referenced model, `update()` validates FK on changed fields, `skipFkValidation: true` bypasses FK check, models without FK declarations have no validation overhead, `references()` target model validation at registration time
- [x] T029 [P] [US3] Write tests for eager loading in `test/relations.test.ts`: `findMany()` with `include: { items: true }` attaches related records as arrays, `readAll()` with `include` works the same, one-to-many relationship loads correctly (parent has array of children), batchGet is used (single API call for all related models, not N sequential reads), `include` with no matching related records returns empty arrays

### Implementation for User Story 3

- [x] T030 [US3] Implement `src/relations.ts`: `validateForeignKeys()` function that takes a record, its schema's relation definitions, and a schemas map, reads the target model's sheet to check existence, throws VALIDATION_ERROR with field name and referenced model if not found, respects `skipFkValidation` option
- [x] T031 [US3] Implement eager loading in `src/relations.ts`: `loadRelated()` function that takes records, include map, relation definitions, and transport context, uses `batchGetValues()` to read all related sheets in one API call, attaches related records as arrays on each parent record by matching FK values
- [x] T032 [US3] Integrate relations into client CRUD: call `validateForeignKeys()` in `create()` and `update()` (before write), pass `include` option through `findMany()` and `readAll()` to `loadRelated()`, verify all tests from T028 and T029 pass
- [x] T033 [US3] Update `src/index.ts` to export relation-related types (`RelationDefinition`, `FindOptions`, `ReadOptions`, `WriteOptions`)

**Checkpoint**: US3 complete. FK validation rejects invalid references on write. Eager loading fetches related records efficiently via batchGet. All tests pass.

---

## Phase 6: User Story 4 — Migration System (Priority: P2)

**Goal**: Versioned `up()` migrations modify spreadsheet structure. Applied migrations tracked in `_genjutsu_migrations` sheet tab. Already-applied migrations skipped silently.

**Independent Test**: Define 3 migrations (create sheet, add column, rename column), run them, verify applied, re-run and verify skipped, add 4th and verify only it runs

### Tests for User Story 4

- [x] T034 [P] [US4] Write tests for migration runner in `test/migrations.test.ts`: `migrate()` creates `_genjutsu_migrations` sheet if missing, `migrate()` reads applied versions and skips already-applied, `migrate()` runs pending migrations in version order, `migrate()` records version/name/timestamp after each success, `migrate()` does NOT record failed migration, `migrate()` wraps up() errors in MIGRATION_ERROR with version and name, `migrate()` rejects duplicate version numbers (SCHEMA_ERROR), `migrate()` rejects non-ascending version order (SCHEMA_ERROR)
- [x] T035 [P] [US4] Write tests for MigrationContext operations in `test/migrations.test.ts`: `createSheet()` sends addSheet batchUpdate request, `addColumn()` sends insertDimension + updateCells (header), `removeColumn()` sends deleteDimension, `renameColumn()` sends updateCells for header cell, `renameSheet()` sends updateSheetProperties, all operations resolve sheet name to sheetId via metadata fetch

### Implementation for User Story 4

- [x] T036 [US4] Implement `src/migrations.ts`: `MigrationContext` class that wraps transport context, resolves sheet names to sheetIds, and provides `createSheet()`, `addColumn()`, `removeColumn()`, `renameColumn()`, `renameSheet()` — each builds the correct batchUpdate request body per research.md R4 — verify tests from T035 pass
- [x] T037 [US4] Implement migration runner in `src/migrations.ts`: `runMigrations()` function that ensures `_genjutsu_migrations` tab exists, reads applied versions, filters pending, executes in order, records successes, wraps failures in MIGRATION_ERROR — verify tests from T034 pass
- [x] T038 [US4] Integrate migration runner into client: wire `db.migrate(migrations)` in `src/client.ts` to call `runMigrations()` with the client's transport context — verify full integration works
- [x] T039 [US4] Update `src/index.ts` to export `Migration`, `MigrationContext` types

**Checkpoint**: US4 complete. Migrations create/modify/rename sheets and columns. Tracking works correctly. All tests pass.

---

## Phase 7: User Story 5 — Polish and npm Readiness (Priority: P3)

**Goal**: Library is publishable to npm with ESM build, TypeScript declarations, zero runtime deps, README with quickstart, and JSDoc on all public API

**Independent Test**: Build the package, verify dist/ contains ESM + declarations, verify `dependencies` in package.json is empty, verify README quickstart is complete

### Implementation for User Story 5

- [x] T040 [P] [US5] Add JSDoc comments to all public functions and types in `src/index.ts`, `src/client.ts`, `src/model.ts`, `src/errors.ts`, `src/relations.ts`, `src/migrations.ts` — each exported symbol must have a description, parameter docs, return type doc, and example where appropriate
- [x] T041 [P] [US5] Update `package.json` with npm publish configuration: `exports` field (ESM entry point + types), `files` field (`dist/`), `types` field, `sideEffects: false`, `repository`, `keywords`, `license` (MIT)
- [x] T042 [US5] Verify build output: run `bun run build`, confirm `dist/` contains `.js` (ESM) and `.d.ts` (declarations) files, confirm zero bundled runtime dependencies, confirm package size is reasonable
- [x] T043 [US5] Validate quickstart.md: follow each code example from `specs/001-genjutsu-db/quickstart.md` and verify the API signatures match the implemented code — fix any discrepancies

**Checkpoint**: US5 complete. Library is npm-ready with clean build output, documentation, and JSDoc.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across all user stories

- [x] T044 Run full test suite (`bun test`) and verify all tests pass across all modules
- [x] T045 Run TypeScript build (`bun run build`) and verify zero compilation errors
- [x] T046 Verify zero domain-specific references: final scan of all `src/` files for application-specific terms
- [x] T047 Verify public API surface: count all exported symbols from `src/index.ts` and confirm count matches contracts/api.md (21 symbols)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational phase — tests then implementation
- **US2 (Phase 4)**: Depends on US1 (uses transport, client, errors, types)
- **US3 (Phase 5)**: Depends on US2 (uses CRUD operations, defineModel)
- **US4 (Phase 6)**: Depends on US1 (uses transport layer), independent of US2/US3
- **US5 (Phase 7)**: Depends on US1–US4 (documents all features)
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1: Setup
    ↓
Phase 2: Foundational
    ↓
Phase 3: US1 (Connection) ← MVP
    ↓           ↓
Phase 4: US2    Phase 6: US4
(CRUD)          (Migrations)
    ↓               ↓
Phase 5: US3        │
(Relations)         │
    ↓               ↓
Phase 7: US5 (Polish) ← depends on all above
    ↓
Phase 8: Final validation
```

### Within Each User Story

- Tests MUST be written FIRST and verified to exist before implementation
- Implementation tasks depend on their corresponding test tasks
- Types and models before services and operations
- Core implementation before integration with client

### Parallel Opportunities

- **Phase 1**: T003 and T004 can run in parallel with T001/T002
- **Phase 2**: T006 and T007 can run in parallel (independent files)
- **US1 Tests**: T011, T012, T013 can all run in parallel (different test files)
- **US2 Tests**: T021 and T022 can run in parallel (same file but independent test groups)
- **US3 Tests**: T028 and T029 can run in parallel
- **US4 Tests**: T034 and T035 can run in parallel
- **US5**: T040 and T041 can run in parallel
- **US4 and US3**: Can run in parallel after US1/US2 since US4 only depends on transport (US1), not CRUD (US2). However US3 depends on US2.

---

## Parallel Example: User Story 1

```bash
# Launch all US1 tests in parallel (different files):
Task: "Write tests for GenjutsuError in test/errors.test.ts"          # T011
Task: "Write tests for utility functions in test/utils.test.ts"        # T012
Task: "Write tests for transport layer in test/transport.test.ts"      # T013

# Then implementation (T015 first, T016 in parallel, then T017, T018 sequentially):
Task: "Implement src/errors.ts"      # T015 (no deps)
Task: "Implement src/utils.ts"       # T016 (parallel with T015)
Task: "Implement src/transport.ts"   # T017 (depends on T015 for error types)
Task: "Implement src/client.ts"      # T018 (depends on T017 for transport)
```

## Parallel Example: US3 + US4 in parallel

```bash
# After US2 is complete, US3 and US4 can start simultaneously:

# Developer A: US3 (Relations)
Task: "Write FK validation tests"     # T028
Task: "Write eager loading tests"     # T029
Task: "Implement relations.ts"        # T030, T031
Task: "Integrate into client"         # T032

# Developer B: US4 (Migrations) — only needs US1, not US2
Task: "Write migration runner tests"  # T034
Task: "Write MigrationContext tests"  # T035
Task: "Implement migrations.ts"       # T036, T037
Task: "Integrate into client"         # T038
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (extract core modules)
3. Complete Phase 3: US1 (connection model + basic operations)
4. **STOP and VALIDATE**: Test US1 independently — connect, read, write, handle errors
5. At this point the library is usable with raw `SheetSchema<T>` (manual schemas)

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Connection model working → MVP for manual-schema consumers
3. US2 → defineModel + CRUD → Full developer experience for new consumers
4. US3 + US4 (parallel) → Relations + Migrations → Production-ready features
5. US5 → Polish + npm → Publishable open-source library

### Key Risk: Phase 2 (Foundational)

The extraction of 6 files from budget-tool is the highest-risk phase. The files must be adapted (renamed types, new error kinds, token provider) while preserving all existing behavior. Mitigation: write tests for the extracted code FIRST (Phase 3 tests), then adapt the code to pass those tests.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Tests are written first per Constitution Principle V
- Source: 6 files extracted from budget-tool (`/Users/ayazuddin/Development/personal/Web/budget-tool/src/lib/sheets-db/`), 3 new files created
- Total estimated scope: ~1500 lines of source code, ~9 source files, ~7 test files
- Commit after each task or logical group
