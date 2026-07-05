import { invoke } from "@tauri-apps/api/core";

/**
 * Stage 1 (issue #1077) — read a user-picked UTF-8 text file (a `.sql`
 * script) so the query editor can load it and run it through the existing
 * execute / Safe Mode pipeline. The backend caps size (16 MiB), rejects
 * app-internal paths, and rejects non-UTF-8 content. Symmetric inverse of
 * `writeTextFileExport`.
 */
export async function readTextFileImport(sourcePath: string): Promise<string> {
  return invoke<string>("read_text_file_import", { sourcePath });
}
