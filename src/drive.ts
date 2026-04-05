/**
 * Low-level HTTP transport for Google Drive v3 REST API.
 * Provides folder and spreadsheet management with appProperties-based identification.
 */

import {
  fetchWithErrorHandling,
  buildAuthHeaders,
} from "./http";
import { driveError } from "./errors";
import type { DriveContext } from "./types";

export const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

// ---------------------------------------------------------------------------
// Find App Folder
// ---------------------------------------------------------------------------

export async function findAppFolder(
  ctx: DriveContext,
  appId: string,
): Promise<{ id: string; name: string } | null> {
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    `appProperties has { key='genjutsuApp' and value='${appId}' }`,
  ].join(" and ");

  const params = new URLSearchParams({
    q,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "10",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const url = `${DRIVE_API}?${params.toString()}`;
  const headers = await buildAuthHeaders(ctx);
  const res = await fetchWithErrorHandling(url, { headers }, ctx);
  const data = (await res.json()) as {
    files?: Array<{ id?: string; name?: string; modifiedTime?: string }>;
  };

  const folder = data.files?.find((f) => f.id && f.name);
  if (!folder?.id || !folder.name) return null;
  return { id: folder.id, name: folder.name };
}

// ---------------------------------------------------------------------------
// Create App Folder
// ---------------------------------------------------------------------------

export async function createAppFolder(
  ctx: DriveContext,
  appId: string,
  folderName: string,
): Promise<{ id: string; name: string }> {
  const url = `${DRIVE_API}?supportsAllDrives=true`;
  const headers: Record<string, string> = {
    ...(await buildAuthHeaders(ctx)),
    "Content-Type": "application/json",
  };

  const res = await fetchWithErrorHandling(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        appProperties: {
          genjutsuApp: appId,
          genjutsuType: "appFolder",
        },
      }),
    },
    ctx,
  );

  const data = (await res.json()) as { id?: string; name?: string };
  if (!data.id || !data.name) {
    throw driveError("Failed to create workspace folder: missing id or name in response");
  }
  return { id: data.id, name: data.name };
}

// ---------------------------------------------------------------------------
// List Spreadsheets in Folder
// ---------------------------------------------------------------------------

export async function listSpreadsheetsInFolder(
  ctx: DriveContext,
  folderId: string,
): Promise<Array<{ id: string; name: string }>> {
  const q = [
    `'${folderId}' in parents`,
    "mimeType='application/vnd.google-apps.spreadsheet'",
    "trashed=false",
  ].join(" and ");

  const params = new URLSearchParams({
    q,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "100",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });

  const url = `${DRIVE_API}?${params.toString()}`;
  const headers = await buildAuthHeaders(ctx);
  const res = await fetchWithErrorHandling(url, { headers }, ctx);
  const data = (await res.json()) as {
    files?: Array<{ id?: string; name?: string; modifiedTime?: string }>;
  };

  return (data.files ?? [])
    .filter((f): f is { id: string; name: string } => Boolean(f.id && f.name))
    .map((f) => ({ id: f.id, name: f.name }));
}

// ---------------------------------------------------------------------------
// Create Spreadsheet in Folder
// ---------------------------------------------------------------------------

export async function createSpreadsheetInFolder(
  ctx: DriveContext,
  folderId: string,
  title: string,
  appId: string,
): Promise<{ id: string; name: string }> {
  const url = `${DRIVE_API}?supportsAllDrives=true`;
  const headers: Record<string, string> = {
    ...(await buildAuthHeaders(ctx)),
    "Content-Type": "application/json",
  };

  const res = await fetchWithErrorHandling(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: title,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [folderId],
        appProperties: {
          genjutsuApp: appId,
          genjutsuType: "spreadsheet",
        },
      }),
    },
    ctx,
  );

  const data = (await res.json()) as { id?: string; name?: string };
  if (!data.id || !data.name) {
    throw driveError("Failed to create workspace spreadsheet: missing id or name in response");
  }
  return { id: data.id, name: data.name };
}
