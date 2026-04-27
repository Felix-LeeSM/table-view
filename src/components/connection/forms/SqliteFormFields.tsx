/**
 * SQLite-specific form fields. SQLite is file-backed: there is no host,
 * port, user, or password. The form exposes a single file path input and
 * (sprint 146 — AC-143-3) a Browse button that pops the OS-native file
 * picker via `@tauri-apps/plugin-dialog`. The `database` column on
 * `ConnectionDraft` carries the chosen path so the backend
 * `connection_test`/`addConnection` command shapes don't change.
 */
import { open } from "@tauri-apps/plugin-dialog";
import type { ConnectionDraft } from "@/types/connection";

export interface SqliteFormFieldsProps {
  draft: ConnectionDraft;
  onChange: (patch: Partial<ConnectionDraft>) => void;
  inputClass: string;
  labelClass: string;
}

export default function SqliteFormFields({
  draft,
  onChange,
  inputClass,
  labelClass,
}: SqliteFormFieldsProps) {
  const handleBrowse = async () => {
    const picked = await open({
      multiple: false,
      directory: false,
      title: "Select SQLite database file",
    });
    if (typeof picked === "string" && picked.length > 0) {
      onChange({ database: picked });
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
          placeholder="/absolute/path/to/database.sqlite"
          aria-label="Database file"
        />
        <button
          type="button"
          aria-label="Browse for database file"
          onClick={handleBrowse}
          className="rounded-md border border-border bg-background px-3 text-xs hover:bg-muted"
        >
          Browse
        </button>
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">
        Absolute path to the SQLite database file. Leave blank to create on
        first connect (if the directory exists).
      </p>
    </div>
  );
}
