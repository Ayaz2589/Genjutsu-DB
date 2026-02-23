# Feature Specification: Raw Range API

**Feature Branch**: `003-raw-range-api`
**Created**: 2026-02-23
**Status**: Draft
**Input**: User description: "Add raw range API to genjutsu-db to expose low-level readRange, writeRange, and clearRange on the client for non-model sheets like Data blob (single cell) and Totals (dynamic columns)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read and Write Arbitrary Cell Ranges (Priority: P1)

A library consumer has a spreadsheet managed by genjutsu-db for structured domain data (e.g., Expenses, Income), but also needs to read and write non-model data — such as a single cell containing a compressed data blob, or a sheet with dynamic columns that change at runtime. Currently, the consumer must build their own HTTP transport layer with manual auth header construction, URL building, and error handling, duplicating logic that already exists inside genjutsu-db. With the raw range API, the consumer uses the same client to read, write, and clear any arbitrary A1-notation range, getting unified authentication, error handling, and retry behavior for free.

**Why this priority**: This is the core capability. Without it, consumers must maintain a parallel transport layer, leading to duplicate auth plumbing, inconsistent error types, and two abstraction layers in their codebase.

**Independent Test**: Can be fully tested by creating a client, calling `readRange`, `writeRange`, and `clearRange` on non-model sheet ranges, and verifying the data round-trips correctly through the same auth and error infrastructure as model operations.

**Acceptance Scenarios**:

1. **Given** a genjutsu-db client with auth configured, **When** the consumer calls `readRange("Data!A1")`, **Then** the client returns the cell value(s) as a 2D array using the same auth token resolution as model operations.
2. **Given** a genjutsu-db client with auth configured, **When** the consumer calls `writeRange("Data!A1", [["blob-content"]])`, **Then** the client writes the values to the specified range using the same auth and error handling as model operations.
3. **Given** a genjutsu-db client with auth configured, **When** the consumer calls `clearRange("Totals!A1:Z100")`, **Then** the client clears the specified range.
4. **Given** a read-only client (apiKey only, no auth), **When** the consumer calls `readRange("Data!A1")`, **Then** the client returns the cell value(s) successfully.
5. **Given** a read-only client (apiKey only, no auth), **When** the consumer calls `writeRange` or `clearRange`, **Then** the client rejects with a permission error, consistent with how model write operations behave.

---

### User Story 2 - Unified Error Handling Across All Sheet Operations (Priority: P2)

A library consumer currently receives different error types from model operations (structured errors with kind, retryAfterMs) versus their own raw HTTP calls (plain Error with status text). With the raw range API, all sheet operations — whether model-based or raw — produce the same structured error types, so the consumer can use a single error handling path.

**Why this priority**: Eliminating dual error handling simplifies consumer code and ensures consistent behavior for auth failures, rate limits, and network errors regardless of which API surface is used.

**Independent Test**: Can be tested by triggering auth failures (401), permission errors (403), and rate limits (429) on raw range calls and verifying they produce the same structured error types as model operations.

**Acceptance Scenarios**:

1. **Given** an expired or invalid auth token, **When** the consumer calls any raw range method, **Then** the client throws the same authentication error type as model operations.
2. **Given** a rate-limited response (429) from the sheets service, **When** the consumer calls any raw range method, **Then** the client throws the same rate limit error type (including retry timing information) as model operations.
3. **Given** a network failure, **When** the consumer calls any raw range method, **Then** the client throws the same network error type as model operations.

---

### Edge Cases

- What happens when the specified range references a sheet tab that doesn't exist? The service returns an error and the client surfaces it as a structured error.
- What happens when `readRange` targets an empty range? The client returns an empty 2D array, consistent with how model reads handle empty sheets.
- What happens when `writeRange` is called with an empty values array? The client handles it gracefully (no-op or empty update).
- What happens when the range string is malformed (e.g., missing sheet name)? The service returns an error and the client surfaces it as a structured error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The client MUST expose a `readRange` method that accepts an A1-notation range string and returns the cell values as a 2D array.
- **FR-002**: The client MUST expose a `writeRange` method that accepts an A1-notation range string and a 2D array of values, and writes them to the specified range (overwrite semantics).
- **FR-003**: The client MUST expose a `clearRange` method that accepts an A1-notation range string and clears all values in that range.
- **FR-004**: All three raw range methods MUST use the same authentication mechanism (token resolution, 401 retry) as model-based operations.
- **FR-005**: All three raw range methods MUST produce the same structured error types as model-based operations for auth failures, permission errors, rate limits, and network errors.
- **FR-006**: `readRange` MUST work on read-only clients (apiKey-based). `writeRange` and `clearRange` MUST reject with a permission error on read-only clients.
- **FR-007**: `readRange` MUST accept an optional value render option (formatted vs. unformatted) to control how the service returns cell values.
- **FR-008**: The raw range methods MUST be accessible as a grouped namespace on the client (e.g., `client.raw.readRange(...)`) to clearly distinguish them from model-based operations.

### Key Entities

- **Range**: An A1-notation string identifying a rectangular region of cells in a specific sheet tab (e.g., `"Data!A1"`, `"Totals!A1:Z100"`).
- **Values**: A 2D array of cell values (`unknown[][]`) — the same format used internally by model operations for row data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Consumers can read, write, and clear any arbitrary sheet range using only the genjutsu-db client — no separate HTTP transport code required.
- **SC-002**: All raw range errors are handled through the same single error handling path as model operations — zero dual-error-handling code in consumer applications.
- **SC-003**: Existing model-based operations continue to work identically — zero regressions in the existing test suite.
- **SC-004**: The raw range API adds no new dependencies to the library.

## Assumptions

- The raw range API uses overwrite (PUT) semantics for `writeRange`, not append. Consumers needing append can use model repositories.
- The `readRange` default value render option is `"FORMATTED_VALUE"`, matching the existing transport layer behavior.
- The raw range methods for writes (`writeRange`, `clearRange`) participate in the client's existing write mutex to prevent concurrent write conflicts. `readRange` does not require the write lock.
- The three methods are grouped under a `raw` namespace on the client object to maintain a clean separation from the model-oriented API surface.

## Scope Boundaries

**In scope**:
- `readRange`, `writeRange`, `clearRange` on the client
- Same auth, error handling, and retry behavior as model operations
- Read-only client support for `readRange`

**Out of scope**:
- Batch raw operations (e.g., reading/writing multiple ranges in one call)
- Append semantics for raw writes
- Sheet creation or structural operations via raw API (use `ensureSchema` for that)
- Formatting operations on raw ranges (use `applyFormatting` for model sheets)
