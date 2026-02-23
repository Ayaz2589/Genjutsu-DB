# Implementation Plan: Raw Range API

**Branch**: `003-raw-range-api` | **Date**: 2026-02-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-raw-range-api/spec.md`

## Summary

Expose the client's internal transport functions (`getSheetValues`, `updateSheet`, `clearRange`) as a public `raw` namespace on the `GenjutsuClient` interface. This lets consumers read, write, and clear arbitrary A1-notation ranges without maintaining a separate HTTP transport layer — while getting the same auth, retry, and structured error handling as model-based operations.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: None (zero runtime deps — Constitution Principle II)
**Storage**: Google Sheets v4 REST API via native `fetch`
**Testing**: Bun test runner, tests in `test/` mirroring `src/`
**Target Platform**: Browser/Node ESM (client-side library)
**Project Type**: Single library package
**Performance Goals**: N/A — delegates to Google Sheets API, no local computation
**Constraints**: Zero runtime dependencies, no `@ts-ignore`/`any` without justification
**Scale/Scope**: 3 new methods on existing client, ~30 lines of implementation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero Domain Knowledge | PASS | Raw range methods are fully generic — no domain concepts |
| II. Zero Runtime Dependencies | PASS | No new dependencies — reuses existing internal transport |
| III. Type Safety Without Codegen | PASS | Methods use standard TypeScript types (`unknown[][]`, `string`) |
| IV. Simplicity | PASS | Three one-liner delegations to existing functions |
| V. Incremental Refactoring | PASS | Tests first, then implementation, then build verification |

No violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/003-raw-range-api/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal — no new entities)
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── client.ts        # Add `raw` property to returned client object
├── types.ts         # Add `RawRangeApi` interface and update `GenjutsuClient`
├── index.ts         # Export `RawRangeApi` type
└── transport.ts     # No changes — already has the functions

test/
└── raw-range.test.ts  # New test file for raw range API
```

**Structure Decision**: Single library project. Only 3 files modified (`types.ts`, `client.ts`, `index.ts`), 1 new test file. No new source files needed — raw range methods are added directly to the client factory.
