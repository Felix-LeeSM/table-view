import { useState } from "react";
import type {
  ConnectionConfig,
  ConnectionDraft,
  DatabaseType,
} from "@/types/connection";
import {
  createEmptyDraft,
  draftFromConnection,
  DATABASE_DEFAULTS,
  DATABASE_DEFAULT_FIELDS,
  paradigmOf,
} from "@/types/connection";

/**
 * Sprint 213 (post-209 P6) — draft form state machine extracted from
 * `ConnectionDialog.tsx`. Owns:
 *
 *   - `form` / `setForm` (the `ConnectionDraft` itself).
 *   - `passwordInput` / `setPasswordInput` (separate UI state, ADR-0005:
 *     the password input is never folded into the draft until save).
 *   - `clearPassword` / `setClearPassword` (edit-mode keep/clear toggle).
 *   - `pendingDbTypeChange` (Sprint 108 — confirmation flow when the user
 *     swaps `dbType` while a custom port is set).
 *   - `applyDbTypeChange` (Sprint 138 — DBMS-aware defaults; preserves
 *     `host` / `name` / `groupId` / `color` / `environment`).
 *   - `resolvePassword` (Sprint 178 — keep/clear/set semantics).
 *   - `trimDraft` (Sprint 178 — name/host/database/user; password verbatim).
 *   - `applyParsedConnection` (URL mode `Parse & Continue` + form-mode
 *     host-paste detection share this merge — both routes borrow the
 *     parsed `database` as the connection name when name is still blank
 *     and populate `passwordInput` separately).
 *
 * No behaviour change vs. pre-split: the hook is a transparent move of the
 * draft state machine. The only delta is that consumers now read/write via
 * the returned API instead of inline `useState` declarations.
 */

export interface UseConnectionDraftFormReturn {
  form: ConnectionDraft;
  setForm: React.Dispatch<React.SetStateAction<ConnectionDraft>>;
  passwordInput: string;
  setPasswordInput: React.Dispatch<React.SetStateAction<string>>;
  clearPassword: boolean;
  setClearPassword: React.Dispatch<React.SetStateAction<boolean>>;
  isEditing: boolean;
  hadPassword: boolean;
  isSqlite: boolean;
  /**
   * Sprint 381 (2026-05-17) — true when the draft targets MongoDB.
   * Mongo's `database` is *optional* (the user can leave it blank and
   * pick one per-tab from the toolbar chip); RDB types still require a
   * non-empty database. ConnectionDialog.handleSave branches on this.
   */
  isMongo: boolean;
  pendingDbTypeChange: { to: DatabaseType } | null;
  handleDbTypeChange: (newDbType: DatabaseType) => void;
  handleConfirmDbTypeReplace: () => void;
  handleCancelDbTypeReplace: () => void;
  resolvePassword: () => string | null;
  trimDraft: (draft: ConnectionDraft) => ConnectionDraft;
  /**
   * Merge a parsed connection into the draft. `parsed` matches the
   * return shape of `parseConnectionUrl` / `parseSqliteFilePath` —
   * `Partial<ConnectionDraft>` (e.g. `authSource` is omitted on
   * non-Mongo URLs).
   *
   * - `mode: "url"` — URL-mode `Parse & Continue` semantics: name fallback
   *   to `parsed.database || ""` and password set whenever it is a string
   *   (including empty string).
   * - `mode: "paste"` — form-mode host-paste detection semantics: name
   *   fallback to `parsed.database || f.name` and password set only when
   *   it is a non-empty string.
   */
  applyParsedConnection: (
    parsed: Partial<ConnectionDraft>,
    mode: "url" | "paste",
  ) => void;
}

export function useConnectionDraftForm(
  connection?: ConnectionConfig,
): UseConnectionDraftFormReturn {
  const isEditing = !!connection;
  const hadPassword = !!connection?.hasPassword;

  const [form, setForm] = useState<ConnectionDraft>(
    connection ? draftFromConnection(connection) : createEmptyDraft(),
  );
  // The password input is a separate piece of UI state. When editing, it
  // starts empty and is only sent if the user actually types something OR
  // explicitly checks "Clear password".
  const [passwordInput, setPasswordInput] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  // Sprint-108 (#CONN-DIALOG-2): when the user changes DB type with a custom
  // port set, defer the swap until they confirm port replacement. The form
  // mutation only applies on confirm; cancel leaves dbType + port untouched.
  const [pendingDbTypeChange, setPendingDbTypeChange] = useState<{
    to: DatabaseType;
  } | null>(null);

  const isSqlite = form.dbType === "sqlite";
  // Sprint 381 (2026-05-17) — Mongo db-contract α: `database` is optional
  // on Mongo (default DB landing field, not connection-required) so the
  // Save validator skips the "Database is required" branch when true.
  const isMongo = form.dbType === "mongodb";

  /**
   * Sprint 138 — when the user changes `dbType`, reset the DBMS-specific
   * defaults (`port`, `user`, `database`) but **preserve** entries the user
   * has likely typed deliberately (`host`, `name`, `groupId`, `color`,
   * `environment`). The `host` preservation matters because users often
   * point all their dev DBMSes at the same host (`localhost`) and it would
   * be hostile to wipe it on every type swap.
   */
  const applyDbTypeChange = (dbType: DatabaseType) => {
    setForm((f) => {
      const defaults = DATABASE_DEFAULT_FIELDS[dbType];
      return {
        ...f,
        dbType: dbType,
        port: defaults.port,
        user: defaults.user,
        database: defaults.database,
        paradigm: paradigmOf(dbType),
      };
    });
  };

  const handleDbTypeChange = (newDbType: DatabaseType) => {
    const oldDbType = form.dbType;
    if (newDbType === oldDbType) return;
    const currentPort = form.port;
    // "Default-or-empty" port → safe to overwrite silently (legacy behaviour).
    // Anything else is a user-customised port and must be confirmed.
    const isDefaultOrEmpty =
      currentPort === DATABASE_DEFAULTS[oldDbType] || currentPort === 0;
    if (isDefaultOrEmpty) {
      applyDbTypeChange(newDbType);
      return;
    }
    setPendingDbTypeChange({ to: newDbType });
  };

  const handleConfirmDbTypeReplace = () => {
    if (!pendingDbTypeChange) return;
    applyDbTypeChange(pendingDbTypeChange.to);
    setPendingDbTypeChange(null);
  };

  const handleCancelDbTypeReplace = () => {
    setPendingDbTypeChange(null);
  };

  /** Resolve the password value to send to the backend. */
  const resolvePassword = (): string | null => {
    if (!isEditing) {
      // New connections: the input is the password (empty string is fine).
      return passwordInput;
    }
    if (clearPassword) return "";
    if (passwordInput.length > 0) return passwordInput;
    // Editing + empty input + not clearing → keep existing
    return null;
  };

  // Sprint 178 (AC-178-02): trim user-pasteable string fields at the
  // save/test boundary, NEVER on keystroke. The list is narrowly scoped:
  // `password` is excluded per ADR-0005 (some legacy systems require
  // whitespace in the password) and `database` for SQLite is treated as
  // a file path which `parseSqliteFilePath` already trims at parse time.
  // Future SSH-key-path or SSH-host fields can extend this list when
  // they are introduced.
  const trimDraft = (draft: ConnectionDraft): ConnectionDraft => ({
    ...draft,
    name: draft.name.trim(),
    host: draft.host.trim(),
    database: draft.database.trim(),
    user: draft.user.trim(),
  });

  /**
   * Merge a parsed connection (from URL mode `Parse & Continue` or form-mode
   * host-paste detection) into the draft. The parsed `password` is routed
   * to `passwordInput` (never the draft) per ADR-0005. Both URL-mode and
   * form-mode borrow the parsed `database` as the name only when `name` is
   * still blank — preserving any user-typed name.
   *
   * The two modes differ in two narrow places, preserved verbatim from the
   * pre-split inline lambdas:
   *   - URL mode: `f.name || parsed.database || ""` + `setPasswordInput`
   *     on any string (including empty).
   *   - Paste mode: `f.name || parsed.database || f.name` + skip
   *     `setPasswordInput` on empty string.
   */
  const applyParsedConnection = (
    parsed: Partial<ConnectionDraft>,
    mode: "url" | "paste",
  ) => {
    const { password, ...rest } = parsed;
    setForm((f) => ({
      ...f,
      ...rest,
      name:
        mode === "url"
          ? f.name || parsed.database || ""
          : f.name || parsed.database || f.name,
    }));
    if (mode === "url") {
      if (typeof password === "string") {
        setPasswordInput(password);
      }
    } else {
      if (typeof password === "string" && password.length > 0) {
        setPasswordInput(password);
      }
    }
  };

  return {
    form,
    setForm,
    passwordInput,
    setPasswordInput,
    clearPassword,
    setClearPassword,
    isEditing,
    hadPassword,
    isSqlite,
    isMongo,
    pendingDbTypeChange,
    handleDbTypeChange,
    handleConfirmDbTypeReplace,
    handleCancelDbTypeReplace,
    resolvePassword,
    trimDraft,
    applyParsedConnection,
  };
}
