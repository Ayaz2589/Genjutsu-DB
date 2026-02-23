# Data Model: Raw Range API

This feature introduces no new data entities or storage schemas. It exposes existing internal transport functions on the client interface.

## New Types

### RawRangeApi

An interface grouping the three raw range methods. Added to `types.ts`.

| Method | Parameters | Returns | Notes |
|--------|-----------|---------|-------|
| `readRange` | `range: string`, `valueRenderOption?: "FORMATTED_VALUE" \| "UNFORMATTED_VALUE"` | `Promise<unknown[][]>` | Read-only, no write mutex |
| `writeRange` | `range: string`, `values: unknown[][]` | `Promise<void>` | Uses write mutex, overwrite semantics |
| `clearRange` | `range: string` | `Promise<void>` | Uses write mutex |

### GenjutsuClient Update

Add `raw: RawRangeApi` property to the existing `GenjutsuClient<S>` interface.

## Existing Types (unchanged)

- `TransportContext` — already holds auth + spreadsheetId, used internally
- `GenjutsuError` — existing structured error type, produced by transport layer
- `Repository<T>` — model-based operations, unchanged
