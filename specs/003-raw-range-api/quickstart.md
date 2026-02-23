# Quickstart: Raw Range API

## Basic Usage

```typescript
import { createClient, defineModel, field } from "genjutsu-db";

const db = createClient({
  spreadsheetId: "your-spreadsheet-id",
  auth: async () => getAccessToken(),
  schemas: {
    contacts: defineModel("Contacts", {
      id: field.string().primaryKey(),
      name: field.string(),
      email: field.string(),
    }),
  },
});

// Model-based operations (existing API — unchanged)
const contacts = await db.repo("contacts").readAll();

// Raw range operations (new API)
// Read a single cell
const blobRows = await db.raw.readRange("Data!A1", "UNFORMATTED_VALUE");
const blob = blobRows[0]?.[0] as string | undefined;

// Write a single cell
await db.raw.writeRange("Data!A1", [["compressed-blob-content"]]);

// Clear a range before rewriting
await db.raw.clearRange("Summary!A1:Z100");
await db.raw.writeRange("Summary!A1:Z100", [
  ["Month", "Total Earned", "Total Spent"],
  ["January", 5000, 3200],
  ["February", 5200, 2800],
]);
```

## Read-Only Client

```typescript
const readOnlyDb = createClient({
  spreadsheetId: "public-spreadsheet-id",
  apiKey: "your-api-key",
  schemas: { /* ... */ },
});

// Reads work
const data = await readOnlyDb.raw.readRange("Sheet1!A1:B10");

// Writes throw a permission error
try {
  await readOnlyDb.raw.writeRange("Sheet1!A1", [["nope"]]);
} catch (err) {
  // GenjutsuError with kind: "PERMISSION_ERROR"
}
```

## Error Handling

```typescript
import { isGenjutsuError } from "genjutsu-db";

try {
  const data = await db.raw.readRange("MissingSheet!A1");
} catch (err) {
  if (isGenjutsuError(err)) {
    switch (err.kind) {
      case "AUTH_ERROR":
        // Token expired — refresh and retry
        break;
      case "RATE_LIMIT":
        // Back off — err.retryAfterMs may be set
        break;
      case "API_ERROR":
        // Sheet doesn't exist, malformed range, etc.
        break;
    }
  }
}
```

## Integration with Budget-Tool (Consumer Example)

Before (dual transport):
```typescript
// Consumer had its own transport.ts with manual fetch calls
import { getSheetValues, updateSheet } from "./transport";
const rows = await getSheetValues(token, spreadsheetId, "Data!A1", "UNFORMATTED_VALUE");
await updateSheet(token, spreadsheetId, "Data!A1", [[blob]]);
// Throws plain Error — different from GenjutsuError
```

After (unified client):
```typescript
// All operations go through the same client
const rows = await db.raw.readRange("Data!A1", "UNFORMATTED_VALUE");
await db.raw.writeRange("Data!A1", [[blob]]);
// Throws GenjutsuError — same as model operations
```
