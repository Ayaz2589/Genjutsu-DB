# Implementation Plan: genjutsu-db

**Branch**: `001-genjutsu-db` | **Date**: 2026-02-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-genjutsu-db/spec.md`

## Summary

Extract the existing `sheets-db` library from the Ortho budget-tool into a standalone, general-purpose Google Sheets database library called **genjutsu-db**. The library provides:

1. **Connection model** with token provider pattern (static string OR async function) and public sheet support via API key
2. **defineModel() API** for TypeScript-first schema definition with full type inference (Drizzle-style, no codegen)
3. **Full CRUD** per model (create, findById, findMany, update, delete) plus bulk operations (readAll, writeAll, append, batchSync)
4. **Relations** with FK validation on write and eager loading via `include`
5. **Migrations** with versioned up() functions tracked in a `_genjutsu_migrations` sheet tab

The library ships with zero runtime dependencies, uses native `fetch` for Google Sheets API v4 REST calls, and targets browser-side usage.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: None (zero runtime dependencies). Dev: Bun test runner, TypeScript compiler.
**Storage**: Google Sheets v4 REST API (remote). No local storage.
**Testing**: Bun test runner (`bun test`)
**Target Platform**: Browser (client-side `fetch`). Compatible with any JavaScript runtime supporting `fetch`.
**Project Type**: Single library package (npm-publishable)
**Performance Goals**: Suitable for small-data stores (hundreds to low thousands of rows per sheet tab). All reads fetch full sheets.
**Constraints**: Zero runtime dependencies. No code generation. No backend. Last-write-wins concurrency. Max ~10K rows per sheet before performance degrades.
**Scale/Scope**: ~10 source files, ~1500 lines. Starting from 676 lines of existing sheets-db code.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Research Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero Domain Knowledge | PASS | Library has zero application-specific concepts. All domain logic comes from consumer via schemas. |
| II. Zero Runtime Dependencies | PASS | Only native `fetch`. Zero npm runtime deps. Dev deps allowed. |
| III. Type Safety Without Codegen | PASS | `defineModel()` uses TypeScript generic inference. No codegen, no CLI, no build plugins. |
| IV. Simplicity | PASS | Full reads, in-memory joins, last-write-wins. No pagination, no query builder, no conflict resolution. |
| V. Incremental Refactoring | PASS | Tests first, then code. Existing sheets-db tests adapted. Strict mode enabled. |

### Post-Design Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero Domain Knowledge | PASS | data-model.md and contracts use generic entities (Contact, Task). Zero budget/finance references. |
| II. Zero Runtime Dependencies | PASS | All 10 API endpoints use native `fetch`. Utilities are pure TypeScript. |
| III. Type Safety Without Codegen | PASS | `defineModel()` → `SheetSchema<InferModelType<F>>`. `repo<K>()` → `Repository<InferEntity<S[K]>>`. No codegen. |
| IV. Simplicity | WATCH | 21 public API symbols exceeds the spec's 15-symbol target (SC-004). Justified: field builder + error factories are necessary for usability. See Complexity Tracking. |
| V. Incremental Refactoring | PASS | Phase 1 tasks copy existing code first, then add new features incrementally. Tests mirror src structure. |

**GATE RESULT: PASS** (no violations, one WATCH item justified in Complexity Tracking)

## Project Structure

### Documentation (this feature)

```text
specs/001-genjutsu-db/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # Entity definitions and relationships
├── quickstart.md        # Consumer usage guide
├── contracts/
│   └── api.md           # TypeScript API contracts
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
src/
├── index.ts             # Public barrel export
├── client.ts            # createClient factory, repo builder, batchSync, ensureSchema, applyFormatting
├── transport.ts         # Low-level Google Sheets API v4 fetch wrappers
├── errors.ts            # GenjutsuError class, error kinds, factory functions
├── types.ts             # SheetSchema, Repository, ClientConfig, FormattingRule, etc.
├── model.ts             # defineModel(), field builder, type inference
├── relations.ts         # FK validation, eager loading (include)
├── migrations.ts        # Migration runner, MigrationContext, tracking sheet
└── utils.ts             # generateId, date/amount parsing, header validation

test/
├── client.test.ts       # Client factory, repo operations, batchSync
├── transport.test.ts    # HTTP layer (mocked fetch)
├── errors.test.ts       # Error creation and type guard
├── model.test.ts        # defineModel, field builder, type inference
├── relations.test.ts    # FK validation, eager loading
├── migrations.test.ts   # Migration runner, tracking
└── utils.test.ts        # Utility functions
```

**Structure Decision**: Single library package. All source in `src/`, tests in `test/` mirroring `src/`. No monorepo, no workspace, no apps directory. The library is standalone — consumers install it via npm.

## Complexity Tracking

> **WATCH item from Constitution Check: Public API surface exceeds SC-004 target**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 21 public symbols vs 15 target (SC-004) | `field` builder (1 symbol) replaces manual schema construction for every model. Error factories (8 functions) enable typed error creation. Both are essential for the library's usability. | Reducing to 15 would require: (a) removing field builder (forces manual parseRow/toRow on every consumer), or (b) removing error factories (forces consumers to construct errors manually). Both alternatives significantly degrade developer experience. The 21-symbol surface is still small and learnable. **Recommendation**: Update SC-004 to 25 symbols. |

## Key Implementation Notes

### Files to Extract from budget-tool

The following 6 files from `/Users/ayazuddin/Development/personal/Web/budget-tool/src/lib/sheets-db/` form the starting point:

| Source File | Lines | Maps To | Changes Needed |
|-------------|-------|---------|----------------|
| `client.ts` | 304 | `src/client.ts` | Add token provider support, add migrate() method |
| `transport.ts` | 100 | `src/transport.ts` | Add token provider, 401 retry, 403→PERMISSION_ERROR, apiKey support, batchGet, create spreadsheet |
| `types.ts` | 87 | `src/types.ts` | Add primaryKey, fields, relations to SheetSchema. Add ClientConfig with auth union. |
| `errors.ts` | 79 | `src/errors.ts` | Rename SheetsDbError→GenjutsuError, add PERMISSION_ERROR + MIGRATION_ERROR kinds |
| `utils.ts` | 70 | `src/utils.ts` | No changes (already generic) |
| `index.ts` | 36 | `src/index.ts` | Update exports for new modules |

### New Files to Create

| File | Purpose | Est. Lines |
|------|---------|-----------|
| `src/model.ts` | defineModel(), field builder, auto-generated parseRow/toRow | ~200 |
| `src/relations.ts` | FK validation on write, eager loading via include/batchGet | ~150 |
| `src/migrations.ts` | Migration runner, MigrationContext, tracking sheet | ~200 |

### Build & Package Configuration

| File | Purpose |
|------|---------|
| `package.json` | Name, version, exports, scripts, zero dependencies |
| `tsconfig.json` | Strict mode, ESM, declaration output |
| `tsconfig.build.json` | Build-specific config (exclude tests) |
