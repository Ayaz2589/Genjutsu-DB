# Quickstart: genjutsu-db

**Feature Branch**: `001-genjutsu-db`
**Date**: 2026-02-19

## Installation

```bash
bun add genjutsu-db
# or
npm install genjutsu-db
```

Zero runtime dependencies — only the library itself is installed.

---

## 1. Define a Model

```typescript
import { defineModel, field } from 'genjutsu-db';

const Contact = defineModel('Contacts', {
  id:    field.string().primaryKey(),
  name:  field.string(),
  email: field.string().optional(),
  age:   field.number().default(0),
});
```

That's it. From these 5 lines, genjutsu-db generates:
- Column headers: `["id", "name", "email", "age"]`
- Row parser: sheet row → typed `Contact` object
- Row serializer: `Contact` object → sheet row
- Validation: type checks, required field checks
- Sheet ranges: `Contacts!A1:D`, etc.

---

## 2. Connect to a Spreadsheet

```typescript
import { createClient } from 'genjutsu-db';

const db = createClient({
  spreadsheetId: '1abc...xyz',  // or full Google Sheets URL
  auth: () => getGoogleAccessToken(),  // your OAuth token provider
  schemas: { contacts: Contact },
});

// Create sheet tabs if they don't exist
await db.ensureSchema();
```

### Connection Options

**Static token** (for quick scripts):
```typescript
const db = createClient({
  spreadsheetId: '1abc...xyz',
  auth: 'ya29.a0AfH6SM...',
  schemas: { contacts: Contact },
});
```

**Public sheet** (read-only, no OAuth):
```typescript
const db = createClient({
  spreadsheetId: '1abc...xyz',
  apiKey: 'AIzaSyD...',
  schemas: { contacts: Contact },
});
```

---

## 3. CRUD Operations

```typescript
const contacts = db.repo('contacts');

// Create
const alice = await contacts.create({
  id: 'c1',
  name: 'Alice',
  email: 'alice@example.com',
});

// Find by ID
const found = await contacts.findById('c1');
// → { id: 'c1', name: 'Alice', email: 'alice@example.com', age: 0 }

// Find many (with filter)
const adults = await contacts.findMany(c => c.age >= 18);

// Update
const updated = await contacts.update('c1', { age: 30 });

// Delete
await contacts.delete('c1');
```

---

## 4. Relations

```typescript
const Task = defineModel('Tasks', {
  id:        field.string().primaryKey(),
  title:     field.string(),
  contactId: field.string().references('contacts', 'id'),
});

const db = createClient({
  spreadsheetId: '1abc...xyz',
  auth: () => getToken(),
  schemas: { contacts: Contact, tasks: Task },
});

// FK validation on create (rejects if contact doesn't exist)
await db.repo('tasks').create({
  id: 't1',
  title: 'Follow up',
  contactId: 'c1',  // must exist in Contacts sheet
});

// Eager loading
const tasksWithContacts = await db.repo('tasks').findMany(
  undefined,
  { include: { contacts: true } }
);
```

---

## 5. Migrations

```typescript
import type { Migration } from 'genjutsu-db';

const migrations: Migration[] = [
  {
    version: 1,
    name: 'add-phone-column',
    up: async (ctx) => {
      await ctx.addColumn('Contacts', 'phone');
    },
  },
  {
    version: 2,
    name: 'create-notes-sheet',
    up: async (ctx) => {
      await ctx.createSheet('Notes');
    },
  },
];

await db.migrate(migrations);
// Runs only pending migrations, tracks in _genjutsu_migrations tab
```

---

## 6. Batch Sync

For applications that sync all data at once (like the Ortho budget tool):

```typescript
await db.batchSync({
  contacts: allContacts,
  tasks: allTasks,
});
// Clears + writes all sheets in 2 API calls
```

---

## 7. Error Handling

```typescript
import { isGenjutsuError } from 'genjutsu-db';

try {
  await contacts.create({ id: 'c1', name: 'Bob' });
} catch (err) {
  if (isGenjutsuError(err)) {
    switch (err.kind) {
      case 'VALIDATION_ERROR':
        console.log('Invalid data:', err.validationIssues);
        break;
      case 'AUTH_ERROR':
        console.log('Token expired, re-authenticate');
        break;
      case 'PERMISSION_ERROR':
        console.log('Read-only access');
        break;
      case 'RATE_LIMIT':
        console.log(`Retry after ${err.retryAfterMs}ms`);
        break;
    }
  }
}
```

---

## 8. Raw Schema (Advanced)

For consumers who need full control over row parsing:

```typescript
import type { SheetSchema } from 'genjutsu-db';

interface CustomRecord {
  id: string;
  data: string;
}

const customSchema: SheetSchema<CustomRecord> = {
  sheetName: 'Custom',
  headers: ['id', 'data'],
  readRange: 'Custom!A1:B',
  writeRange: 'Custom!A1:B',
  clearRange: 'Custom!A2:B',
  parseRow: (row) => ({
    id: String(row[0] ?? ''),
    data: String(row[1] ?? ''),
  }),
  toRow: (r) => [r.id, r.data],
};

const db = createClient({
  spreadsheetId: '...',
  auth: '...',
  schemas: { custom: customSchema },
});

// Works with readAll/writeAll/append (no CRUD methods for raw schemas)
const records = await db.repo('custom').readAll();
```

---

## Sharing Patterns

| Pattern | Config | Capabilities |
|---------|--------|--------------|
| Full access (owner) | `auth: token` | Read + Write + Migrate |
| Shared read/write | `auth: token` (shared user) | Read + Write |
| Read-only shared | `auth: token` (viewer) | Read only, writes → PERMISSION_ERROR |
| Public published | `apiKey: key` | Read only, writes → PERMISSION_ERROR |
