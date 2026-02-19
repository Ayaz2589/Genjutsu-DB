# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**genjutsu-db** — a general-purpose Google Sheets database library for TypeScript. Define typed models, persist data to Google Sheets, and get full CRUD + relations + migrations with zero backend infrastructure. Each user's Google Sheet is their own private database.

## Commands

```bash
bun install          # Install dependencies
bun test             # Run all tests
bun run build        # TypeScript check + build
bun run lint         # ESLint
```

## Architecture

### Core Concepts
- **defineModel()**: TypeScript-first schema definition (like Drizzle, not Prisma — no codegen)
- **Repository**: Full CRUD (create, findById, findMany, update, delete) per model
- **Connection**: Token provider pattern — static string OR async `getToken()` function
- **Relations**: FK validation on write + eager loading via `include`
- **Migrations**: Versioned `up()` functions tracked in `_genjutsu_migrations` sheet tab

### Key Design Decisions
- **Remote only**: Library talks to Google Sheets API. No local cache — app manages its own state
- **Small-data store**: Best for hundreds to low thousands of rows per table
- **All computation in browser**: Reads fetch full sheets, joins happen in-memory
- **User-owned database**: Each user's Google Sheet is their own DB in Google Drive
- **Zero runtime dependencies**: Pure `fetch`-based, no external libraries

### Sharing Patterns
1. Shared spreadsheet (multiple users, full read/write)
2. Read-only (403 handling for shared read-only access)
3. Cross-spreadsheet (connect to any spreadsheet user has access to)
4. Public/no-auth (published sheets, read-only, no token required)

## Key Conventions

- Package manager is **Bun**
- TypeScript strict mode enabled
- Zero runtime dependencies — only `fetch` for HTTP
- ESM build output with TypeScript declarations
- Path alias `@/` maps to `src/`
- Tests in `test/` mirror `src/` structure

## Active Technologies
- TypeScript 5.x (strict mode) + None (zero runtime dependencies). Dev: Bun test runner, TypeScript compiler. (001-genjutsu-db)
- Google Sheets v4 REST API (remote). No local storage. (001-genjutsu-db)

## Recent Changes
- 001-genjutsu-db: Added TypeScript 5.x (strict mode) + None (zero runtime dependencies). Dev: Bun test runner, TypeScript compiler.
