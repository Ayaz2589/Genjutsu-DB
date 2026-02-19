<!--
  Sync Impact Report
  ==================
  Version change: 0.0.0 (template) → 1.0.0 (initial ratification)
  Modified principles: N/A (all new)
  Added sections:
    - 5 Core Principles (I–V)
    - Technology Constraints
    - Development Workflow
    - Governance
  Removed sections: None (first fill)
  Templates requiring updates:
    - .specify/templates/plan-template.md       ✅ No updates needed (generic)
    - .specify/templates/spec-template.md        ✅ No updates needed (generic)
    - .specify/templates/tasks-template.md       ✅ No updates needed (generic)
  Follow-up TODOs: None
-->

# genjutsu-db Constitution

## Core Principles

### I. Zero Domain Knowledge

The library MUST have zero knowledge of any consuming application's domain.
No entity-specific concepts (expenses, contacts, tasks, etc.) may exist in
library code:

- All domain types come from the consumer via `defineModel()` or `SheetSchema<T>`
- Examples in documentation use generic domains (contacts, tasks, inventory)
- Test fixtures use synthetic test-only entities, never real-world domain data
- If a function only makes sense for one domain, it belongs in the consumer

### II. Zero Runtime Dependencies

The library MUST ship with zero runtime dependencies. This is non-negotiable:

- HTTP via native `fetch` — no axios, got, or node-fetch
- TypeScript types only — no runtime type-checking libraries (zod, io-ts)
- ID generation via `Date.now()` + `Math.random()` — no uuid
- All computation in-memory — no external caching, queuing, or storage
- Dev dependencies (testing, building, linting) are allowed

### III. Type Safety Without Codegen

TypeScript's type system MUST provide full type inference from schema
definitions. No code generation step, no CLI tools, no build plugins:

- `defineModel()` returns fully typed schemas via generic inference
- `repo<K>()` returns `Repository<InferEntity<S[K]>>` — no manual casting
- Errors are discriminated unions (`GenjutsuError.kind`) for exhaustive handling
- `as any` and `@ts-ignore` are prohibited without documented justification

### IV. Simplicity

Complexity MUST be justified. The right amount of complexity is the minimum
needed for the current task:

- Google Sheets is a small-data store (hundreds to low thousands of rows)
- All reads fetch the full sheet — no pagination, no partial reads
- Joins happen in-memory after full reads — no query builder, no lazy loading
- Last-write-wins for concurrent access — no conflict resolution, no locking
- Do not design for hypothetical future requirements

### V. Incremental Refactoring Discipline

Code changes MUST follow the incremental refactor cycle:

- Add or update tests FIRST, then change code, then run `bun test`
- New features MUST NOT break existing tests
- TypeScript strict mode MUST remain enabled
- Prefer editing existing files over creating new ones

## Technology Constraints

**Stack (locked):**
- TypeScript 5.x (strict mode)
- Bun (package manager, test runner, script runner)
- Native `fetch` for HTTP (no backend, client-side only)
- Google Sheets v4 REST API
- ESM output with TypeScript declarations

**Prohibited:**
- Runtime dependencies (zero allowed)
- Code generation or CLI tools for schema management
- Backend services or server-side processing
- `@ts-ignore` or `any` without documented justification
- Skipping pre-commit hooks (`--no-verify`)

## Development Workflow

**Branch strategy:** Feature branches off `main`. PRs required for merge.

**Local development cycle:**
1. Make changes following incremental refactor discipline (Principle V)
2. `bun test` — verify all tests pass after each change
3. `bun run build` — verify TypeScript and production build
4. `bun run lint` — verify no lint errors

**Testing standards:**
- Bun test runner
- Tests live in `test/` mirroring `src/` structure
- All public API functions MUST have tests

## Governance

This constitution is the authoritative source of project principles.
It supersedes ad-hoc decisions and informal conventions:

- **Amendments** require updating this document, incrementing the version
  (MAJOR for principle removal/redefinition, MINOR for new principles or
  material expansion, PATCH for clarifications), and propagating changes
  to dependent templates via the `/speckit.constitution` command.
- **Compliance** is enforced by TypeScript strict mode and code review
  against these principles.
- **Complexity justification**: any deviation from Principle IV (Simplicity)
  MUST be documented in the plan's Complexity Tracking table with
  rationale and rejected alternatives.
- **Runtime guidance**: see `CLAUDE.md` for AI-assisted development
  conventions that complement this constitution.

**Version**: 1.0.0 | **Ratified**: 2026-02-19 | **Last Amended**: 2026-02-19
