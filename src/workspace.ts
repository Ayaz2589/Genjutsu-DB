/**
 * Workspace orchestrator: finds or creates an app-specific folder and spreadsheet
 * in the user's Google Drive using appProperties metadata for collision-proof identification.
 */

import {
  findAppFolder,
  createAppFolder,
  listSpreadsheetsInFolder,
  createSpreadsheetInFolder,
} from "./drive";
import { validationError } from "./errors";
import type { WorkspaceConfig, ResolvedWorkspace } from "./types";

export async function resolveWorkspace(
  config: WorkspaceConfig,
): Promise<ResolvedWorkspace> {
  // Validate config
  if (!config.auth) {
    throw validationError("resolveWorkspace requires OAuth auth", [
      { field: "auth", message: "auth is required (Drive API needs user authorization)" },
    ]);
  }
  if (!config.appId) {
    throw validationError("appId must be a non-empty string", [
      { field: "appId", message: "appId is required" },
    ]);
  }
  if (!config.defaultSpreadsheetName) {
    throw validationError("defaultSpreadsheetName must be a non-empty string", [
      { field: "defaultSpreadsheetName", message: "defaultSpreadsheetName is required" },
    ]);
  }

  const ctx = { auth: config.auth };
  const folderName = config.folderName || config.appId;
  let created = false;

  // Step 1: Find or create the app folder
  let folder = await findAppFolder(ctx, config.appId);
  if (!folder) {
    folder = await createAppFolder(ctx, config.appId, folderName);
    created = true;
  }

  // Step 2: List spreadsheets in the folder
  let spreadsheets = await listSpreadsheetsInFolder(ctx, folder.id);

  // Step 3: Create default spreadsheet if none exist
  if (spreadsheets.length === 0) {
    const newSheet = await createSpreadsheetInFolder(
      ctx,
      folder.id,
      config.defaultSpreadsheetName,
      config.appId,
    );
    spreadsheets = [newSheet];
    created = true;
  }

  return {
    folderId: folder.id,
    spreadsheetId: spreadsheets[0].id,
    spreadsheets,
    created,
  };
}
