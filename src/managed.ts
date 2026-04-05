/**
 * Convenience factory that combines workspace resolution with client creation.
 */

import { resolveWorkspace } from "./workspace";
import { createClient } from "./client";
import type {
  SheetSchema,
  GenjutsuClient,
  ManagedClientConfig,
  ResolvedWorkspace,
} from "./types";

export async function createManagedClient<
  S extends Record<string, SheetSchema<any>>,
>(
  config: ManagedClientConfig<S>,
): Promise<{ client: GenjutsuClient<S>; workspace: ResolvedWorkspace }> {
  const workspace = await resolveWorkspace({
    appId: config.appId,
    folderName: config.folderName,
    defaultSpreadsheetName: config.defaultSpreadsheetName,
    auth: config.auth,
  });

  const client = createClient({
    spreadsheetId: workspace.spreadsheetId,
    auth: config.auth,
    schemas: config.schemas,
  });

  return { client, workspace };
}
