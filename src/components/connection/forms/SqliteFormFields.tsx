/**
 * File-backed SQL form fields. SQLite and DuckDB have no host, port, user,
 * or password; the form exposes a single file path input and a Browse button
 * that pops the OS-native file picker via `@tauri-apps/plugin-dialog`. The
 * `database` column on `ConnectionDraft` carries the chosen path so the
 * backend `connection_test`/`addConnection` command shapes don't change.
 */
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Database, FolderOpen, LockKeyhole } from "lucide-react";
import { createSqliteDatabaseFile } from "@/lib/tauri/connection";
import type { ConnectionDraft } from "@/types/connection";

export interface SqliteFormFieldsProps {
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
  filePickerEnabled: boolean;
  inputClass: string;
  labelClass: string;
  databaseLabel?: string;
  defaultPath?: string;
  fileExtensions?: string[];
  createEnabled?: boolean;
}

export default function SqliteFormFields({
  draft,
  onChange,
  filePickerEnabled,
  inputClass,
  labelClass,
  databaseLabel = "SQLite",
  defaultPath = "database.sqlite",
  fileExtensions = ["sqlite", "sqlite3", "db"],
  createEnabled = true,
}: SqliteFormFieldsProps) {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const selectTitle = `Select ${databaseLabel} database file`;
  const createTitle = `Create ${databaseLabel} database file`;

  const handleBrowse = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      title: selectTitle,
    });
    if (typeof picked === "string" && picked.length > 0) {
      onChange({ database: picked });
    }
  };

  const handleCreate = async () => {
    setCreateError(null);
    try {
      const picked = await save({
        title: createTitle,
        defaultPath: draft.database || defaultPath,
        filters: [
          {
            name: `${databaseLabel} database`,
            extensions: fileExtensions,
          },
        ],
      });
      if (typeof picked !== "string" || picked.length === 0) {
        return;
      }

      setCreating(true);
      const created = await createSqliteDatabaseFile(picked);
      onChange({ database: created });
    } catch (error) {
      setCreateError(String(error));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <label htmlFor="conn-sqlite-path" className={labelClass}>
        Database File
      </label>
      <div className="flex items-stretch gap-2">
        <input
          id="conn-sqlite-path"
          className={`${inputClass} flex-1`}
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder={`/absolute/path/to/${defaultPath}`}
          aria-label="Database file"
        />
        {filePickerEnabled && (
          <>
            <button
              type="button"
              aria-label="Browse for database file"
              onClick={handleBrowse}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs hover:bg-muted"
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              Browse
            </button>
            {createEnabled && (
              <button
                type="button"
                aria-label={createTitle}
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Database className="h-3.5 w-3.5" aria-hidden="true" />
                {creating ? "Creating" : "Create"}
              </button>
            )}
          </>
        )}
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">
        Absolute path to a {databaseLabel} database file.
      </p>
      <label className="mt-3 flex items-center gap-2 text-xs text-secondary-foreground">
        <input
          type="checkbox"
          checked={draft.readOnly === true}
          onChange={(e) => onChange({ readOnly: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-border"
        />
        <LockKeyhole
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden="true"
        />
        Open read-only
      </label>
      {createError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {createError}
        </p>
      )}
    </div>
  );
}
