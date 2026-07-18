import type { TableTabInit } from "@/stores/workspaceStore/types";

// One place that builds the kv-paradigm detail-tab descriptor, shared by the
// sidebar (key click) and the new-key composer (post-create). Both open the
// same right-hand detail tab; keeping the payload here stops the two call sites
// from drifting.
export function kvKeyDetailTab(
  connectionId: string,
  database: number,
  key: string,
): TableTabInit {
  const db = String(database);
  return {
    title: key,
    connectionId,
    type: "table",
    closable: true,
    database: db,
    schema: db,
    table: key,
    subView: "structure",
    paradigm: "kv",
  };
}
