/**
 * Sprint 138 (#4 — DBMS-aware connection form): SQLite-specific form
 * fields. SQLite is file-backed: there is no host, port, user, or password.
 * The form replaces those rows with a single file path input. A native
 * file picker would normally come from `@tauri-apps/plugin-dialog`; this
 * sprint ships the text-input fallback (the plugin is not yet a project
 * dependency — see handoff Risks). The `database` column on
 * `ConnectionDraft` carries the file path so the backend
 * `connection_test`/`addConnection` command shapes do not need to change.
 */
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
  return (
    <>
      <div>
        <label htmlFor="conn-sqlite-path" className={labelClass}>
          Database File
        </label>
        <input
          id="conn-sqlite-path"
          className={inputClass}
          value={draft.database}
          onChange={(e) => onChange({ database: e.target.value })}
          placeholder="/absolute/path/to/database.sqlite"
          aria-label="SQLite database file path"
        />
        <p className="mt-1 text-2xs text-muted-foreground">
          Absolute path to the SQLite database file. Leave blank to create on
          first connect (if the directory exists).
        </p>
      </div>
    </>
  );
}
