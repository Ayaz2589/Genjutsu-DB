# Research: Raw Range API

## Decision 1: Namespace Design — `client.raw.*` vs Top-Level Methods

**Decision**: Group under a `raw` namespace on the client (`client.raw.readRange(...)`)

**Rationale**: Keeps the primary client surface clean and model-oriented. The `raw` prefix clearly signals "you're bypassing the schema layer." Avoids polluting autocomplete with low-level methods when consumers are using model repos.

**Alternatives considered**:
- **Top-level methods** (`client.readRange(...)`): Simpler but muddies the distinction between typed model ops and untyped range ops. Risk of consumers using raw methods when they should use repos.
- **Separate factory** (`createRawClient(...)`): Over-engineered — forces consumers to manage two client instances with the same auth. Violates Principle IV (Simplicity).

## Decision 2: Write Semantics — Overwrite Only vs Overwrite + Append

**Decision**: `writeRange` uses overwrite (PUT) semantics only. No append parameter.

**Rationale**: The raw API targets two use cases: single-cell blob writes and full-sheet rewrites (clear + write). Both use PUT. Append is a model-layer concern (needs header awareness). Adding an append option would complicate the API for a use case that's already served by `repo.append()`.

**Alternatives considered**:
- **Append parameter** (`writeRange(range, values, { append: true })`): Adds complexity for a use case that raw callers shouldn't need. If they need append, they should use a model.
- **Separate `appendRange` method**: Feature creep. No known use case.

## Decision 3: Write Mutex Participation

**Decision**: `writeRange` and `clearRange` participate in the existing write mutex. `readRange` does not.

**Rationale**: The write mutex exists to serialize all writes and prevent interleaving (e.g., a clear + write pair being interrupted by a batchSync). Raw writes have the same interleaving risk, so they must go through the same lock. Reads are safe to run concurrently.

**Alternatives considered**:
- **No mutex for raw writes**: Would allow raw writes to interleave with model writes, potentially corrupting data. Rejected.
- **Separate mutex**: Unnecessary complexity. One spreadsheet = one write serialization point.

## Decision 4: `readRange` Value Render Option

**Decision**: Accept an optional `valueRenderOption` parameter defaulting to `"FORMATTED_VALUE"`.

**Rationale**: The existing internal `getSheetValues` already supports this parameter. The budget-tool's blob reader needs `"UNFORMATTED_VALUE"` to avoid formatting artifacts. Exposing it costs nothing and avoids forcing consumers to work around a missing option.

**Alternatives considered**:
- **Always FORMATTED_VALUE**: Would break the blob use case (formatted values add currency symbols to numeric cells).
- **Always UNFORMATTED_VALUE**: Would change semantics for consumers expecting formatted strings.

## Decision 5: Return Type for `readRange`

**Decision**: Return `unknown[][]` — same as the internal `getSheetValues`.

**Rationale**: Raw range reads are schema-less by definition. The consumer knows what data to expect and can cast as needed. Returning a typed generic would be misleading since there's no parseRow to validate shape.

**Alternatives considered**:
- **Generic `readRange<T>(...): T[][]`**: Type theater — the actual data is still `unknown[][]` at runtime. Would require unsafe casting internally.
