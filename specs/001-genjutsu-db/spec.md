# Feature Specification: genjutsu-db — Google Sheets Database Library

**Feature Branch**: `001-genjutsu-db`
**Created**: 2026-02-19
**Status**: Draft
**Input**: User description: "Extract sheets-db into standalone general-purpose Google Sheets database library with defineModel, CRUD, relations, and migrations. Each user's Google Sheet is their own private database. Zero backend, zero runtime dependencies, full type inference."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Library Extraction and Connection Model (Priority: P1)

As a developer, I can install genjutsu-db as a standalone package, connect to any Google Spreadsheet using either a static OAuth token or an async token provider function, and perform basic read/write operations. The library has zero knowledge of any consuming application's domain — it is a general-purpose data persistence layer.

**Why this priority**: Without extraction and a working connection model, nothing else functions. This is the foundation: a standalone package that can authenticate and talk to Google Sheets. The token provider pattern is essential because OAuth tokens expire, and the library must handle token refresh gracefully without the consumer managing retry logic.

**Independent Test**: Install the library in a fresh project, create a connection with a token provider, and successfully read from and write to a Google Spreadsheet — all without any domain-specific code existing in the library.

**Acceptance Scenarios**:

1. **Given** a developer installs the library, **When** they create a connection with a static OAuth token and a spreadsheet ID, **Then** the library connects and can perform read/write operations against that spreadsheet.
2. **Given** a developer provides an async token provider function instead of a static token, **When** the current token expires mid-operation, **Then** the library calls the provider to get a fresh token and retries the operation transparently.
3. **Given** a developer connects to a publicly published Google Sheet without providing any token, **When** they attempt to read data, **Then** the read succeeds. **When** they attempt to write data, **Then** the library returns a clear permission error explaining writes require authentication.
4. **Given** a developer connects to a spreadsheet shared as read-only, **When** they attempt to write, **Then** the library returns a permission error (not a generic network error) with a clear message indicating insufficient access.
5. **Given** a developer provides a full Google Sheets URL instead of a bare spreadsheet ID, **When** they create a connection, **Then** the library extracts the spreadsheet ID from the URL automatically.
6. **Given** a developer needs to provision a new spreadsheet for a new user, **When** they call the create spreadsheet utility, **Then** a new empty spreadsheet is created in the user's Google Drive and the spreadsheet ID is returned.
7. **Given** the library source code, **When** scanned for domain-specific terms from any consuming application, **Then** zero references to any application-specific concepts are found.

---

### User Story 2 - Full CRUD and defineModel API (Priority: P1)

As a developer, I can define typed data models using a declarative `defineModel()` API that specifies field names, types, and options. From these model definitions, the library automatically generates all the schema plumbing (column headers, row parsers, row serializers, ranges) and provides a full CRUD repository (create, findById, findMany, update, delete) for each model. Developers who prefer manual control can still use the raw `SheetSchema<T>` interface for custom parseRow/toRow logic.

**Why this priority**: Equal priority with US1 because defineModel + CRUD is what makes the library usable beyond raw read/write. Without it, every consumer must manually build schemas and implement their own CRUD operations — which defeats the purpose of a database library.

**Independent Test**: Define a "Contact" model with name (string), email (string), age (number), and active (boolean) fields using `defineModel()`. Create records, find them by ID, query with filters, update a field, delete a record, and verify each operation works correctly against a real Google Sheet.

**Acceptance Scenarios**:

1. **Given** a developer defines a model with typed fields (string, number, date, boolean), **When** the model is registered with the library, **Then** column headers, row parsing, row serialization, and sheet ranges are automatically generated from the field definitions.
2. **Given** a registered model, **When** a developer calls `create(record)`, **Then** the record is validated against the field definitions, assigned a primary key if auto-generated, and appended to the sheet.
3. **Given** a sheet with existing records, **When** a developer calls `findById(id)`, **Then** the library reads all rows, finds the matching record by primary key, and returns it as a fully typed entity (or null if not found).
4. **Given** a sheet with existing records, **When** a developer calls `findMany()` with an optional filter function, **Then** the library reads all rows, applies the filter in-memory, and returns matching records as typed entities.
5. **Given** a sheet with existing records, **When** a developer calls `update(id, changes)`, **Then** the library reads all rows, locates the record by ID, applies the partial update, validates the result, and writes the full dataset back to the sheet.
6. **Given** a sheet with existing records, **When** a developer calls `delete(id)`, **Then** the library reads all rows, filters out the target record, and rewrites the remaining records to the sheet.
7. **Given** a developer who prefers manual schema control, **When** they define a raw `SheetSchema<T>` with custom parseRow/toRow functions, **Then** the library works identically with this manual schema — the CRUD operations and `defineModel()` are not required.
8. **Given** a model with a field marked as primary key, **When** a developer attempts to create two records with the same primary key value, **Then** the library rejects the second create with a validation error.
9. **Given** a model with fields marked as optional, **When** a developer creates a record without providing those fields, **Then** the record is created successfully with default values (if specified) or null.
10. **Given** bulk data operations, **When** a developer calls `readAll()` or `writeAll()`, **Then** the existing bulk operations continue to work unchanged alongside the new CRUD operations.

---

### User Story 3 - Relations and Referential Integrity (Priority: P2)

As a developer, I can declare foreign key relationships between models at the field level. When writing records, the library validates that referenced records exist. When reading records, I can eagerly load related records using an `include` option, similar to how a relational database handles joins.

**Why this priority**: Relations add significant value for any multi-model application (contacts + notes, orders + line items, etc.), but the library is fully usable without them. This builds on top of the CRUD foundation from US2 and is opt-in — models without foreign keys work exactly as before.

**Independent Test**: Define an "Order" model and an "OrderItem" model where OrderItem has a foreign key to Order. Create an Order, create OrderItems referencing it, verify FK validation rejects an OrderItem with a non-existent Order ID, and verify eager loading returns Orders with their Items attached.

**Acceptance Scenarios**:

1. **Given** a model field declared with a foreign key reference to another model, **When** a developer creates a record with a valid foreign key value, **Then** the library validates the referenced record exists in the target model's sheet and the create succeeds.
2. **Given** a model field with a foreign key reference, **When** a developer creates a record with a foreign key value that does not exist in the target model, **Then** the library rejects the write with a validation error identifying the invalid reference.
3. **Given** models with foreign key relationships, **When** a developer reads records with an `include` option specifying related models, **Then** the library performs additional reads on related sheets and attaches matching records to each parent record.
4. **Given** a one-to-many relationship (e.g., Order has many OrderItems), **When** a developer reads Orders with `include: { items: true }`, **Then** each Order is returned with an array of its related OrderItems.
5. **Given** a developer who wants to skip FK validation for a specific write (e.g., bulk import), **When** they pass `{ skipFkValidation: true }` as a write option, **Then** the library writes the record without checking foreign key references.
6. **Given** a model with no foreign key declarations, **When** records are written, **Then** no FK validation occurs — the feature is entirely opt-in.

---

### User Story 4 - Migration System (Priority: P2)

As a developer, I can define versioned migration functions that modify the spreadsheet structure (add/remove/rename columns, create/rename sheets) and the library tracks which migrations have been applied. This allows the schema to evolve over time without manual spreadsheet editing.

**Why this priority**: Migrations are essential for any real-world application that evolves over time, but the library can ship and be useful without them initially. This is a P2 because it builds on the connection and model layer (US1 + US2) and is needed when schemas change — not on day one.

**Independent Test**: Define three migrations (create a sheet, add a column, rename a column), run them against a spreadsheet, verify all three are applied, re-run the same migrations and verify they are skipped (already applied), add a fourth migration and verify only the new one runs.

**Acceptance Scenarios**:

1. **Given** a developer defines a list of versioned migrations (each with a version number, name, and an up function), **When** they call the migrate function, **Then** the library checks which migrations have already been applied, runs only the pending ones in order, and records each successful migration.
2. **Given** migrations have been applied to a spreadsheet, **When** the developer adds new migrations and runs migrate again, **Then** only the new migrations execute — previously applied migrations are skipped silently.
3. **Given** a migration that creates a new sheet tab, **When** the migration runs, **Then** the new sheet tab is created in the spreadsheet.
4. **Given** a migration that adds a column to an existing sheet, **When** the migration runs, **Then** the new column is added at the specified position with the correct header.
5. **Given** a migration that removes a column, **When** the migration runs, **Then** the column and its data are removed from the sheet.
6. **Given** a migration that renames a column header, **When** the migration runs, **Then** the header cell is updated to the new name.
7. **Given** a migration that renames a sheet tab, **When** the migration runs, **Then** the sheet tab name is updated in the spreadsheet.
8. **Given** a migration that fails mid-execution (e.g., network error), **When** the error propagates, **Then** the error message includes the migration version number and name for debugging, and the failed migration is not recorded as applied.
9. **Given** the library is tracking applied migrations, **When** a developer inspects the spreadsheet, **Then** a dedicated tracking sheet tab exists containing the version, name, and timestamp of each applied migration.

---

### User Story 5 - Polish and npm Readiness (Priority: P3)

As a developer in the open-source community, I can discover genjutsu-db on npm, install it with a single command, follow the README quickstart to connect to a Google Sheet and perform CRUD operations within minutes, and trust that the library has a clean, well-documented API with zero runtime dependencies.

**Why this priority**: Publishing to npm is the final step — the library must work correctly before it can be distributed. Documentation, error naming, and package configuration are polish that make the library accessible to external developers.

**Independent Test**: In a brand-new project with no prior context, install the package from npm, follow the README instructions to connect to a Google Sheet, create a model, and perform a CRUD operation. The entire flow should work without consulting any source other than the README.

**Acceptance Scenarios**:

1. **Given** the library is published to npm, **When** a developer runs the install command, **Then** zero runtime dependencies are installed alongside the library.
2. **Given** a developer reads the README, **When** they follow the quickstart section, **Then** they can successfully connect to a Google Sheet and perform a basic read/write operation within 5 minutes.
3. **Given** the library has a typed error system, **When** a permission error (403) occurs, **Then** the error kind is clearly distinguishable from authentication errors (401) and other API errors.
4. **Given** the library has a typed error system, **When** a migration fails, **Then** the error kind is clearly distinguishable from other error types and includes migration-specific context.
5. **Given** a developer imports the library, **When** they use autocomplete in their editor, **Then** all public types and functions have TypeScript declarations with JSDoc descriptions.
6. **Given** the library is built for distribution, **When** the build output is inspected, **Then** it contains ESM modules and TypeScript declaration files with zero bundled runtime dependencies.
7. **Given** the Ortho budget-tool application currently uses sheets-db as an internal module, **When** genjutsu-db is published, **Then** the budget-tool can switch to importing genjutsu-db as an npm dependency with no behavior changes.

---

### Edge Cases

- **Token expiry mid-operation**: The token provider pattern handles this — the library calls the async `getToken()` function before each API call (or on 401 retry), getting a fresh token transparently without the consumer managing retry logic.
- **403 on shared read-only sheet**: The library returns a specific permission error (distinct from auth errors) with a clear message about insufficient access. Reads may succeed; writes are rejected.
- **Public sheet without authentication**: When no token is provided, the library allows read operations against published sheets. Any write attempt returns a permission error. The consumer is never allowed to accidentally send unauthenticated write requests.
- **Concurrent writes by shared users**: The library uses last-write-wins semantics. This is a documented limitation — Google Sheets does not support transactional writes, so the last batchUpdate call wins. Consumers who need conflict resolution must implement it at the application layer.
- **Sheet exceeds row limits**: The library reads full sheets into memory. For sheets with more than a few thousand rows, performance degrades. This is documented as a design constraint — genjutsu-db is a small-data store, not a replacement for a traditional database.
- **Migration fails mid-execution**: The error includes the migration version and name. The failed migration is not recorded as applied, so re-running migrate will retry it. Partial structural changes (e.g., column added but migration not recorded) are documented as a known edge case requiring manual cleanup.
- **Duplicate primary key on create**: The library reads existing records, checks for duplicate primary key values, and rejects the create with a validation error before making any API call.
- **Schema with zero fields**: The library rejects model definitions with zero fields at registration time with a clear schema error.
- **Two models pointing to the same sheet name**: The library rejects duplicate sheet names at registration time with a clear schema error.
- **Consumer's custom parseRow throws**: For raw `SheetSchema<T>` consumers, if the parseRow function throws, the library wraps the error with the row index for debugging.
- **FK validation on large datasets**: FK validation reads the referenced model's full sheet to check existence. For large datasets, this is expensive. The `skipFkValidation` option lets consumers bypass this for bulk operations.
- **Legacy schemas without defineModel**: Consumers using the raw `SheetSchema<T>` interface are supported forever. The `defineModel()` API is an ergonomic layer on top, not a replacement.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The library MUST be a standalone, independently installable package with zero runtime dependencies.
- **FR-002**: The library MUST accept authentication via either a static OAuth token string or an async token provider function that returns a fresh token on each call.
- **FR-003**: The library MUST support an optional no-auth mode for reading publicly published Google Sheets without any token.
- **FR-004**: The library MUST provide a `createSpreadsheet()` utility for provisioning new empty spreadsheets in a user's Google Drive.
- **FR-005**: The library MUST extract spreadsheet IDs from full Google Sheets URLs automatically.
- **FR-006**: The library MUST return distinct, typed error kinds for authentication failures (401), permission failures (403), rate limiting (429), network errors, validation errors, schema errors, migration errors, and general API errors.
- **FR-007**: The library MUST provide a `defineModel(sheetName, fields)` API that generates typed schemas from declarative field definitions, supporting string, number, date, and boolean field types.
- **FR-008**: Each field definition MUST support options for primary key designation, optionality, and default values.
- **FR-009**: The library MUST auto-generate column headers, row parsers, row serializers, and sheet ranges from field definitions.
- **FR-010**: The library MUST provide full CRUD operations per model: `create(record)`, `findById(id)`, `findMany(filter?)`, `update(id, changes)`, and `delete(id)`.
- **FR-011**: The `create` operation MUST validate against field definitions and reject duplicate primary keys.
- **FR-012**: The `update` operation MUST read all rows, locate by primary key, apply partial changes, validate the result, and write the full dataset back.
- **FR-013**: The `delete` operation MUST read all rows, filter out the target, and rewrite the remaining records.
- **FR-014**: The library MUST preserve bulk operations (`readAll`, `writeAll`, `append`) alongside individual CRUD operations.
- **FR-015**: The library MUST support the raw `SheetSchema<T>` interface with custom `parseRow`/`toRow` functions for consumers who need manual control — this is backward compatible and always supported.
- **FR-016**: The library MUST support field-level foreign key declarations that reference another model and field.
- **FR-017**: FK validation on write MUST check that the referenced record exists in the target model's sheet, and reject with a validation error if it does not.
- **FR-018**: FK validation MUST be opt-in — only models with declared foreign keys trigger validation, and consumers can skip it per-write via an option.
- **FR-019**: The library MUST support an `include` option on read operations for eager loading related records from foreign key relationships.
- **FR-020**: The library MUST provide a migration system with versioned `up()` functions that modify spreadsheet structure.
- **FR-021**: The migration system MUST track applied migrations in a dedicated sheet tab with version, name, and timestamp.
- **FR-022**: The migration system MUST skip already-applied migrations silently and only execute pending migrations in order.
- **FR-023**: Migration context MUST provide operations for creating sheets, adding columns, removing columns, renaming columns, and renaming sheets.
- **FR-024**: Migration errors MUST include the migration version and name for debugging.
- **FR-025**: The library MUST serialize all write operations through a mutex to prevent interleaved API calls.
- **FR-026**: The library MUST provide batch operations that clear and write all registered models' sheets in two API calls (one batchClear, one batchUpdate).
- **FR-027**: The library MUST provide an `ensureSchema()` operation that creates missing sheet tabs for all registered models.
- **FR-028**: The library MUST allow consumers to register optional validators per model, called before write operations.
- **FR-029**: The library MUST allow consumers to register optional formatting rules per sheet, applied via a dedicated formatting operation.
- **FR-030**: The library MUST have zero imports from any consuming application — all domain types and logic come from the consumer via configuration.
- **FR-031**: The library MUST be publishable to npm with ESM build output and TypeScript declarations.
- **FR-032**: The library MUST include documentation with installation instructions, quickstart guide, API reference, and sharing pattern examples.

### Key Entities

- **Connection**: Represents an authenticated link to a Google Spreadsheet — includes spreadsheet identity, authentication credentials (static or provider), and optional configuration. A single connection serves all models within one spreadsheet.
- **Model Definition**: Declares how a data type maps to a Google Sheet tab — includes the tab name, field declarations (name, type, options), and optional validators. From a model definition, the library derives all schema plumbing automatically.
- **Field**: Describes a single column in a sheet — has a name, a data type (string, number, date, boolean), and options (primary key, optional, default value, foreign key reference).
- **Repository**: A bound set of CRUD operations for a single model — provides create, findById, findMany, update, delete, readAll, writeAll, and append. Repositories are created automatically from model definitions.
- **Migration**: A versioned schema change — has a version number, human-readable name, and an up function that receives a context object with structural modification operations. Applied migrations are tracked in a dedicated sheet tab.
- **Error**: A typed error with a kind discriminant — allows consumers to handle different failure modes (auth, permission, rate limit, network, validation, schema, migration, API) with exhaustive pattern matching.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The library installs with zero runtime dependencies — `npm install` or `bun add` adds only the library itself, with no transitive packages.
- **SC-002**: A developer with no prior knowledge of the library can follow the README quickstart to connect to a Google Sheet, define a model, and perform a create-read cycle within 5 minutes.
- **SC-003**: A new data model can be defined and used (with full CRUD) by writing fewer than 20 lines of consumer code — no library source changes required.
- **SC-004**: All four sharing patterns (shared read/write, read-only, cross-spreadsheet, public no-auth) work correctly with distinct, typed error handling for each access level.
- **SC-005**: The migration system correctly tracks applied migrations and skips them on re-run — running the same migration set twice produces no errors and no duplicate side effects.
- **SC-006**: FK validation catches 100% of invalid references on write (when enabled) and the `include` option correctly loads related records for one-to-many relationships.
- **SC-007**: The library's public API has full TypeScript type inference — autocomplete and type checking work without manual type annotations or casting in consumer code.
- **SC-008**: The existing Ortho budget-tool can switch from its internal sheets-db module to the published genjutsu-db package with zero behavior changes to its sync functionality.

## Assumptions

- The library targets browser-side usage (client-side `fetch`), consistent with its origin in a browser-based application. No Node.js-specific APIs (fs, path, process) are required.
- Google Sheets API v4 is the target API. The library uses REST endpoints directly via `fetch` — no Google client libraries.
- OAuth tokens are obtained by the consuming application (via Google Sign-In, OAuth flow, etc.). The library does not implement any OAuth flow itself — it only consumes tokens.
- The write mutex (Promise chain serialization) is sufficient for single-tab concurrency control. Multi-tab browser scenarios are out of scope.
- Sheet formatting (bold headers, currency columns, etc.) remains an opt-in feature managed through consumer-provided formatting rules.
- The `_genjutsu_migrations` sheet tab name is reserved by the library and must not be used by consumers for data models.
- Cascading deletes, many-to-many relations, nested includes beyond one level, and full query builders are explicitly out of scope — the library is a small-data store, not an ORM.
