# Quickstart: Drive Workspace API

**Branch**: `004-drive-workspace-api` | **Date**: 2026-04-05

## Basic Usage: resolveWorkspace + createClient

The most common pattern — resolve a workspace, then create a typed client:

```typescript
import { resolveWorkspace, createClient, defineModel, field } from "genjutsu-db";

// 1. Define your models
const Task = defineModel("Tasks", {
  id: field.string().primaryKey(),
  title: field.string(),
  done: field.boolean().default(false),
});

// 2. Resolve workspace (finds or creates folder + spreadsheet in user's Drive)
const workspace = await resolveWorkspace({
  appId: "task-tracker",              // unique identifier for your app
  folderName: "Task Tracker",         // what the user sees in Drive
  defaultSpreadsheetName: "Tasks DB", // created on first run
  auth: getAccessToken,               // OAuth token or async provider
});

// workspace.created === true on first run
// workspace.spreadsheetId is ready to use

// 3. Create the genjutsu-db client with the resolved spreadsheet
const db = createClient({
  spreadsheetId: workspace.spreadsheetId,
  auth: getAccessToken,
  schemas: { tasks: Task },
});

// 4. Use the client as usual
await db.ensureSchema();
const task = await db.repo("tasks").create({ title: "Ship it" });
```

## Convenience: createManagedClient

If you don't need the two-step flow, combine both into one call:

```typescript
import { createManagedClient, defineModel, field } from "genjutsu-db";

const Task = defineModel("Tasks", {
  id: field.string().primaryKey(),
  title: field.string(),
  done: field.boolean().default(false),
});

const { client, workspace } = await createManagedClient({
  appId: "task-tracker",
  folderName: "Task Tracker",
  defaultSpreadsheetName: "Tasks DB",
  auth: getAccessToken,
  schemas: { tasks: Task },
});

// client is a fully configured GenjutsuClient
// workspace has folderId, spreadsheetId, spreadsheets[], created flag
await client.ensureSchema();
```

## Custom Workspace Flows

For apps that need finer control (e.g., multi-spreadsheet selection):

```typescript
import {
  findAppFolder,
  createAppFolder,
  listSpreadsheetsInFolder,
  createSpreadsheetInFolder,
} from "genjutsu-db";

const ctx = { auth: getAccessToken };

// Find existing folder
let folder = await findAppFolder(ctx, "my-app");

// Create if not found
if (!folder) {
  folder = await createAppFolder(ctx, "my-app", "My App Data");
}

// List all spreadsheets in the folder
const sheets = await listSpreadsheetsInFolder(ctx, folder.id);

// Let user pick, or create a new one
const newSheet = await createSpreadsheetInFolder(
  ctx,
  folder.id,
  "January 2026",
  "my-app",
);
```

## OAuth Scope Requirement

The workspace API requires the `drive.file` OAuth scope:

```
https://www.googleapis.com/auth/drive.file
```

This is the **least-privilege** Drive scope — it only grants access to files your app created or the user opened with your app. It does **not** grant access to the user's entire Drive.

## What the User Sees in Drive

```
My Drive/
  Task Tracker/          ← normal-looking folder (no developer naming conventions)
    Tasks DB.gsheet      ← normal-looking spreadsheet
```

The `appProperties` metadata is invisible in the Drive UI. Users can rename or move these files and the library will still find them by metadata.
