// ---------------------------------------------------------------------------
// Sprint-96 escape hatch — Layer-1 primitives only (no Layer-2 preset).
//
// The other 7 dialogs (`GroupDialog`, `ImportExportDialog`, `BlobViewerDialog`,
// `CellDetailDialog`, `SqlPreviewDialog`, `MqlPreviewModal`,
// `AddDocumentModal`) are wrapped by the new `ConfirmDialog` / `FormDialog` /
// `PreviewDialog` / `TabsDialog` presets. ConnectionDialog stays on the raw
// Layer-1 primitives (`<Dialog*>` + `<DialogFeedback>` from
// `@components/ui/dialog`) because it has bespoke needs that no preset
// captures cleanly:
//   1. Custom footer split (Test Connection on the left, Cancel + Save on the
//      right) with `justify-between`.
//   2. The sprint-92 `expectNodeStable` contract on the
//      `data-slot="test-feedback"` slot — driven by `DialogFeedback`'s
//      `slotName` override that callers other than this file don't need.
//   3. URL-mode toggle + scrollable inner column with `max-h-[60vh]`.
//   4. Save error rendered alongside (not inside) the test-feedback slot.
//
// Per `docs/dialog-conventions.md`, this file is the sole sanctioned escape
// hatch — new dialogs should pick a preset.
//
// Sprint 138 (#4 — DBMS-aware connection form): the inner network/auth/db
// row(s) are no longer rendered inline. `db_type` switches into one of five
// sub-components (Pg/Mysql/Sqlite/Mongo/Redis) so the form shape and
// defaults match each DBMS. The `assertNever` exhaustive check in the
// switch statement guarantees a new `DatabaseType` variant breaks the
// build instead of silently falling through to the PG layout.
// ---------------------------------------------------------------------------

import { useState } from "react";
import type {
  ConnectionConfig,
  ConnectionDraft,
  DatabaseType,
} from "@/types/connection";
import { Button } from "@components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import {
  createEmptyDraft,
  draftFromConnection,
  DATABASE_DEFAULTS,
  DATABASE_DEFAULT_FIELDS,
  parseConnectionUrl,
  parseSqliteFilePath,
  paradigmOf,
  ENVIRONMENT_META,
  ENVIRONMENT_OPTIONS,
} from "@/types/connection";
import { useConnectionStore } from "@stores/connectionStore";
import { X, Loader2, Plug, Link, List } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFeedback,
  type DialogFeedbackState,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@components/ui/dialog";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { assertNever } from "@/lib/paradigm";
import PgFormFields from "./forms/PgFormFields";
import MysqlFormFields from "./forms/MysqlFormFields";
import SqliteFormFields from "./forms/SqliteFormFields";
import MongoFormFields from "./forms/MongoFormFields";
import RedisFormFields from "./forms/RedisFormFields";

// Sprint-112: Radix `<SelectItem>` cannot have an empty value, so we use
// sentinel string `__none__` to represent the "None" environment option.
// The form's `environment` field still stores `null` (canonical empty).
const ENV_NONE_SENTINEL = "__none__";

/**
 * Sprint 178 (AC-178-05): sanitise an error message before surfacing it
 * in any user-visible region (`role="alert"`, `role="status"`, the
 * `<DialogFeedback>` slot's `aria-live="polite"` body, etc.). Backends
 * sometimes echo the connection string (including the password) in
 * their error copy; ADR-0005 says no plaintext password leaves the
 * frontend without an IPC handshake — so even if the IPC layer hands
 * us back an error containing the password, the renderer must mask it
 * before painting the DOM.
 *
 * Replaces every occurrence of the plaintext password (raw + URL-encoded
 * variant) with `***`. Empty/whitespace-only password values are
 * treated as no-op so legitimate error copy isn't mutated for users
 * with no password set.
 */
export function sanitizeMessage(
  raw: string,
  ...secrets: Array<string | null | undefined>
): string {
  let out = raw;
  for (const secret of secrets) {
    if (!secret || secret.length === 0) continue;
    // `replaceAll` requires a literal substring (not a regex) to avoid
    // accidental regex-meta interpretation of the password.
    out = out.split(secret).join("***");
    // Also mask the URL-encoded form (e.g. `pass@1` → `pass%401`) so
    // the literal connection-string echo can't surface the encoded
    // password. `encodeURIComponent` is the same routine the URL parser
    // expects; if encoding is a no-op we don't add a redundant pass.
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) {
      out = out.split(encoded).join("***");
    }
  }
  return out;
}

interface ConnectionDialogProps {
  connection?: ConnectionConfig;
  onClose: () => void;
}

/**
 * Sprint-92 (#CONN-DIALOG-6): Test Connection result state is modelled as a
 * discriminated union over four explicit states. Previously this was a
 * combination of `testing: boolean` + `testResult: {success, message} | null`,
 * which left the (testing=true, testResult=non-null) corner ambiguous and
 * caused the alert slot to unmount/remount between clicks. The slot is now
 * always mounted (see `data-slot="test-feedback"` below) and only its content
 * varies with `status`.
 */
type TestResultState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export default function ConnectionDialog({
  connection,
  onClose,
}: ConnectionDialogProps) {
  const isEditing = !!connection;
  const hadPassword = !!connection?.has_password;
  const [inputMode, setInputMode] = useState<"form" | "url">("form");
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionDraft>(
    connection ? draftFromConnection(connection) : createEmptyDraft(),
  );
  // The password input is a separate piece of UI state. When editing, it
  // starts empty and is only sent if the user actually types something OR
  // explicitly checks "Clear password".
  const [passwordInput, setPasswordInput] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [testResult, setTestResult] = useState<TestResultState>({
    status: "idle",
  });
  const testing = testResult.status === "pending";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sprint-108 (#CONN-DIALOG-2): when the user changes DB type with a custom
  // port set, defer the swap until they confirm port replacement. The form
  // mutation only applies on confirm; cancel leaves dbType + port untouched.
  const [pendingDbTypeChange, setPendingDbTypeChange] = useState<{
    to: DatabaseType;
  } | null>(null);
  // Sprint 178 (Postel's Law): when the form-mode host paste is recognised
  // as a connection URL, we render a calm inline note next to the host
  // field announcing what was detected. The note is non-modal, advisory,
  // never role="alert"/"status" — that contract is enforced by AC-178-04
  // (silent on malformed pastes) and AC-178-05 (no password leak via
  // alert regions).
  const [detectedScheme, setDetectedScheme] = useState<string | null>(null);

  // Sprint-95 Layer-1 migration: project the local 4-state union onto the
  // generic DialogFeedback contract. `pending` → `loading` is the only naming
  // delta; messages flow through unchanged.
  const feedbackState: DialogFeedbackState =
    testResult.status === "pending" ? "loading" : testResult.status;
  const feedbackMessage =
    testResult.status === "success" || testResult.status === "error"
      ? testResult.message
      : undefined;

  const addConnection = useConnectionStore((s) => s.addConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const testConnection = useConnectionStore((s) => s.testConnection);

  /**
   * Sprint 138 — when the user changes `db_type`, reset the DBMS-specific
   * defaults (`port`, `user`, `database`) but **preserve** entries the user
   * has likely typed deliberately (`host`, `name`, `group_id`, `color`,
   * `environment`). The `host` preservation matters because users often
   * point all their dev DBMSes at the same host (`localhost`) and it would
   * be hostile to wipe it on every type swap.
   */
  const applyDbTypeChange = (dbType: DatabaseType) => {
    setForm((f) => {
      const defaults = DATABASE_DEFAULT_FIELDS[dbType];
      return {
        ...f,
        db_type: dbType,
        port: defaults.port,
        user: defaults.user,
        database: defaults.database,
        paradigm: paradigmOf(dbType),
      };
    });
  };

  const handleDbTypeChange = (newDbType: DatabaseType) => {
    const oldDbType = form.db_type;
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

  const isSqlite = form.db_type === "sqlite";

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

  const handleTest = async () => {
    // Sprint-92: publish pending first so the alert slot shows the spinner +
    // "Testing..." while the request is in flight; the slot itself stays
    // mounted across this transition.
    setTestResult({ status: "pending" });
    try {
      // Sprint 178 (AC-178-02): trim non-password string fields before
      // dispatching the test. Password is sent verbatim per ADR-0005.
      const draft: ConnectionDraft = trimDraft({
        ...form,
        password: resolvePassword(),
      });
      const msg = await testConnection(draft, connection?.id ?? null);
      setTestResult({ status: "success", message: msg });
    } catch (e) {
      // Sprint 178 (AC-178-05): the backend's error message can naively
      // echo the connection string (including the password). Sanitise
      // the rendered message so no password substring lands in any
      // role="alert"/role="status"/aria-live region.
      setTestResult({
        status: "error",
        message: sanitizeMessage(String(e), passwordInput, form.password),
      });
    }
  };

  const handleSave = async () => {
    // Sprint 178: validate against trimmed values so a user typing only
    // whitespace into Name/Host gets the same "required" error they'd
    // get from a blank input. The existing `.trim()` checks already
    // covered Name; the trim helper centralises the policy.
    const trimmed = trimDraft({ ...form, password: resolvePassword() });
    if (!trimmed.name) {
      setError("Name is required");
      return;
    }
    // SQLite uses `database` as the file path; host is irrelevant. The
    // host check applies only to network DBMSes.
    if (!isSqlite && !trimmed.host) {
      setError("Host is required");
      return;
    }
    if (isSqlite && !trimmed.database) {
      setError("Database file is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // Sprint 178 (AC-178-02): outgoing payload uses trimmed values.
      // Password (resolvePassword()) is set on the trimmed copy
      // verbatim — `trimDraft` only trims non-password keys.
      if (isEditing) {
        await updateConnection(trimmed);
      } else {
        await addConnection(trimmed);
        // After a new connection is saved, surface it to the user — Sidebar
        // listens for this and flips to Connections mode if needed.
        window.dispatchEvent(new Event("connection-added"));
      }
      onClose();
    } catch (e) {
      // Sprint 178 (AC-178-05): sanitise error text so a backend that
      // echoes the connection string does not surface the password.
      setError(sanitizeMessage(String(e), passwordInput, form.password));
    }
    setSaving(false);
  };

  // ─────────────────────────────────────────────────────────────────────
  // Sprint 178 — form-mode URL paste detection (AC-178-01) + host:port
  // blur split (AC-178-03). Paste is the explicit user-intent trigger;
  // change events are intentionally NOT used because typing a host like
  // `db.example.com` would otherwise fire detection mid-stream.
  //
  // The handlers live on the form wrapper (delegated via React's
  // synthetic-event bubbling). They short-circuit on any target other
  // than `#conn-host` so other inputs (name/user/database/password) are
  // not affected.
  // ─────────────────────────────────────────────────────────────────────
  const RECOGNISED_SCHEMES = [
    "postgres",
    "postgresql",
    "mysql",
    "mariadb",
    "mongodb",
    "mongodb+srv",
    "redis",
    "sqlite",
  ] as const;

  const looksLikeRecognisedUrl = (text: string): boolean => {
    const trimmed = text.trim();
    return RECOGNISED_SCHEMES.some(
      (scheme) =>
        trimmed.startsWith(`${scheme}://`) ||
        // sqlite uses `sqlite:/path` (single slash), so accept that too.
        (scheme === "sqlite" && trimmed.startsWith("sqlite:")),
    );
  };

  const handleHostPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.id !== "conn-host") return;
    const pasted = e.clipboardData?.getData("text") ?? "";
    if (!pasted) return;
    if (!looksLikeRecognisedUrl(pasted)) return;
    // Try the URL parser first. SQLite URLs land in the same parser
    // branch (`sqlite:/path` is supported by `parseConnectionUrl`). A
    // falsy result means malformed (e.g. `postgres://`); per AC-178-04
    // we silently leave the host field unchanged — no toast, no alert.
    const parsed = parseConnectionUrl(pasted.trim());
    if (!parsed) {
      // Malformed URL paste — silent best-effort, do nothing. The user's
      // pasted text continues into the host field via the default paste
      // behaviour. No alert region added.
      return;
    }
    // Successful parse: prevent the literal URL from also landing in the
    // host field (which would create a fight between `parsed.host` and
    // the raw paste). Then merge the parsed fields into the draft and
    // populate the password input separately.
    e.preventDefault();
    const { password, ...rest } = parsed;
    setForm((f) => ({
      ...f,
      ...rest,
      // Borrow the database name as a connection name only if the user
      // hasn't started typing one yet (matches URL-mode `Parse & Continue`
      // behaviour at lines 414-416).
      name: f.name || parsed.database || f.name,
    }));
    if (typeof password === "string" && password.length > 0) {
      setPasswordInput(password);
    }
    setDetectedScheme(parsed.db_type ?? null);
  };

  // AC-178-03: on blur of the host field, split a single-`:`-then-digits
  // suffix into the port. The regex `^([^\[:][^:]*):(\d+)$` rejects
  // bracket-form IPv6 (`[::1]:5432` — first char `[`), multi-colon IPv6
  // (`::1:5432` — first char `:`, second `:` violates the no-colon
  // segment), and non-digit ports (`db.example.com:abcd`).
  const HOST_PORT_RE = /^([^[:][^:]*):(\d+)$/;
  const handleHostBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.id !== "conn-host") return;
    const value = (target as HTMLInputElement).value;
    const match = value.match(HOST_PORT_RE);
    if (!match) return;
    const hostPart = match[1];
    const portPart = match[2];
    if (typeof hostPart !== "string" || typeof portPart !== "string") return;
    const port = parseInt(portPart, 10);
    if (Number.isNaN(port)) return;
    setForm((f) => ({ ...f, host: hostPart, port }));
  };

  const inputClass =
    "w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary";
  const labelClass = "mb-1 block text-xs font-medium text-secondary-foreground";

  /**
   * Sprint 138 — exhaustive switch on `db_type`. Adding a new
   * `DatabaseType` variant without updating this switch fails the
   * `assertNever` compile-time check.
   */
  const renderDbmsFields = () => {
    const sharedAuth = {
      passwordInput,
      setPasswordInput,
      isEditing,
      hadPassword,
      clearPassword,
      setClearPassword,
      inputClass,
      labelClass,
    };
    const onChange = (patch: Partial<ConnectionDraft>) =>
      setForm((f) => ({ ...f, ...patch }));

    switch (form.db_type) {
      case "postgresql":
        return (
          <PgFormFields draft={form} onChange={onChange} {...sharedAuth} />
        );
      case "mysql":
        return (
          <MysqlFormFields draft={form} onChange={onChange} {...sharedAuth} />
        );
      case "sqlite":
        return (
          <SqliteFormFields
            draft={form}
            onChange={onChange}
            inputClass={inputClass}
            labelClass={labelClass}
          />
        );
      case "mongodb":
        return (
          <MongoFormFields draft={form} onChange={onChange} {...sharedAuth} />
        );
      case "redis":
        return (
          <RedisFormFields draft={form} onChange={onChange} {...sharedAuth} />
        );
      default:
        return assertNever(form.db_type);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex w-dialog-sm flex-col gap-0 bg-secondary p-0"
        showCloseButton={false}
      >
        {/* Header — DialogHeader's row-based default (sprint-91) puts the X
            inline with the title without any extra override. */}
        <DialogHeader className="border-b border-border px-4 py-3">
          <DialogTitle
            id="dialog-title"
            className="text-sm font-semibold text-foreground"
          >
            {isEditing ? "Edit Connection" : "New Connection"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing
              ? "Edit the connection details"
              : "Create a new database connection"}
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X />
          </Button>
        </DialogHeader>

        {/* Form */}
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {/* Input mode toggle */}
          {!isEditing && (
            <div className="mb-3">
              <ToggleGroup
                type="single"
                value={inputMode}
                onValueChange={(v) => v && setInputMode(v as "form" | "url")}
                className="w-full"
              >
                <ToggleGroupItem value="form" className="flex-1">
                  <List />
                  Form
                </ToggleGroupItem>
                <ToggleGroupItem value="url" className="flex-1">
                  <Link />
                  URL
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          )}

          {/* URL input */}
          {inputMode === "url" && !isEditing && (
            <div className="space-y-3">
              <div>
                <label htmlFor="conn-url" className={labelClass}>
                  Connection URL
                </label>
                <input
                  id="conn-url"
                  className={inputClass}
                  value={urlValue}
                  onChange={(e) => {
                    setUrlValue(e.target.value);
                    setUrlError(null);
                  }}
                  placeholder="postgresql://user:password@host:5432/database"
                  autoFocus
                />
                <p className="mt-1 text-2xs text-muted-foreground">
                  For SQLite, paste an absolute file path (e.g.{" "}
                  <code>/data/app.sqlite</code>).
                </p>
              </div>
              {urlError && (
                <div
                  role="alert"
                  className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {urlError}
                </div>
              )}
              <Button
                className="w-full"
                size="sm"
                onClick={() => {
                  // Sprint 138 — try URL parse first; if SQLite is the
                  // currently-selected DBMS or the URL doesn't look like
                  // a recognised scheme, fall back to treating the input
                  // as a SQLite file path.
                  const parsed =
                    parseConnectionUrl(urlValue) ??
                    (form.db_type === "sqlite"
                      ? parseSqliteFilePath(urlValue)
                      : null);
                  if (!parsed) {
                    setUrlError(
                      "Invalid URL. Use format: postgresql://user:password@host:port/database (or paste a SQLite file path while SQLite is selected).",
                    );
                    return;
                  }
                  const { password, ...rest } = parsed;
                  setForm((f) => ({
                    ...f,
                    ...rest,
                    name: f.name || parsed.database || "",
                  }));
                  if (typeof password === "string") {
                    setPasswordInput(password);
                  }
                  setInputMode("form");
                }}
              >
                Parse & Continue
              </Button>
            </div>
          )}

          {/* Form fields */}
          {inputMode === "form" && (
            // Sprint 178 (AC-178-01 / AC-178-03): paste-detect + blur-split
            // are wired via React's bubbled synthetic events on the form
            // wrapper. Both handlers short-circuit on any target other
            // than `#conn-host` (the input rendered by the DBMS-specific
            // form field). This avoids prop-drilling new handler props
            // through every form sub-component.
            <div
              className="space-y-3"
              onPaste={handleHostPaste}
              onBlur={handleHostBlur}
            >
              {/* Name */}
              <div>
                <label htmlFor="conn-name" className={labelClass}>
                  Name
                </label>
                <input
                  id="conn-name"
                  className={inputClass}
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="My Database"
                  autoFocus
                />
              </div>

              {/* Database Type */}
              <div>
                <label htmlFor="conn-db-type" className={labelClass}>
                  Database Type
                </label>
                <Select
                  value={form.db_type}
                  onValueChange={(v) => handleDbTypeChange(v as DatabaseType)}
                >
                  <SelectTrigger
                    id="conn-db-type"
                    className={inputClass}
                    aria-label="Database Type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postgresql">PostgreSQL</SelectItem>
                    <SelectItem value="mysql">MySQL</SelectItem>
                    <SelectItem value="sqlite">SQLite</SelectItem>
                    <SelectItem value="mongodb">MongoDB</SelectItem>
                    <SelectItem value="redis">Redis</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Environment */}
              <div>
                <label htmlFor="conn-environment" className={labelClass}>
                  Environment
                </label>
                <Select
                  value={form.environment ?? ENV_NONE_SENTINEL}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      environment: v === ENV_NONE_SENTINEL ? null : v,
                    }))
                  }
                >
                  <SelectTrigger
                    id="conn-environment"
                    className={inputClass}
                    aria-label="Environment"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ENV_NONE_SENTINEL}>None</SelectItem>
                    {ENVIRONMENT_OPTIONS.map((env) => (
                      <SelectItem key={env} value={env}>
                        {ENVIRONMENT_META[env].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* DBMS-aware fields (Sprint 138) */}
              {renderDbmsFields()}

              {/* Sprint 178 (AC-178-01) — non-modal "detected" affordance.
                  This is a calm, advisory inline note shown after a
                  successful URL paste into the host field. It deliberately
                  does NOT carry `role="alert"` or `role="status"` so it
                  cannot be confused with an error region (AC-178-04
                  silence on malformed pastes) and the AC-178-05 password
                  leak guard does not need to walk this region (it never
                  contains password text either way). The copy is
                  declarative ("Detected … URL — fields populated") and
                  matches the muted-foreground tone of the URL-mode help
                  text at line 546-549. */}
              {detectedScheme && (
                <p
                  className="text-2xs text-muted-foreground"
                  data-testid="connection-url-detected"
                >
                  Detected {detectedScheme} URL — fields populated.
                </p>
              )}

              {/* Advanced Settings */}
              <div className="border-t border-border pt-3">
                <details>
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-secondary-foreground">
                    Advanced Settings
                  </summary>
                  <div className="mt-2 space-y-3">
                    <div>
                      <label htmlFor="conn-timeout" className={labelClass}>
                        Connection Timeout (seconds)
                      </label>
                      <input
                        id="conn-timeout"
                        className={inputClass}
                        type="number"
                        min={5}
                        max={600}
                        value={form.connection_timeout ?? 300}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            connection_timeout:
                              parseInt(e.target.value, 10) || 300,
                          }))
                        }
                        placeholder="300"
                      />
                    </div>
                    <div>
                      <label htmlFor="conn-keepalive" className={labelClass}>
                        Keep-Alive Interval (seconds)
                      </label>
                      <input
                        id="conn-keepalive"
                        className={inputClass}
                        type="number"
                        min={5}
                        max={300}
                        value={form.keep_alive_interval ?? 30}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            keep_alive_interval:
                              parseInt(e.target.value, 10) || 30,
                          }))
                        }
                        placeholder="30"
                      />
                    </div>
                  </div>
                </details>
              </div>
            </div>
          )}
        </div>

        {/* Alerts — pinned outside the scroll container so Test result /
              save error are always visible regardless of scroll position or
              Advanced Settings being open.

              Sprint-95 Layer-1 migration: this slot is now rendered by the
              base `<DialogFeedback>` primitive. The `slotName` override keeps
              the sprint-92 `data-slot="test-feedback"` selector contract
              intact so `expectNodeStable` continues to track the same DOM
              node across state transitions. `DialogFeedback` itself owns the
              "always mounted + min-h reserved" guarantee that previously
              lived inline here. */}
        <DialogFeedback
          slotName="test-feedback"
          state={feedbackState}
          message={feedbackMessage}
          loadingText="Testing..."
          className="border-t border-border px-4 py-3"
        />
        {error && (
          <div
            role="alert"
            className="border-t border-border bg-destructive/10 px-4 py-3 text-sm text-destructive duration-200 animate-in fade-in slide-in-from-top-1"
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? (
                <Loader2 className="animate-spin size-3.5" />
              ) : (
                <Plug />
              )}
              Test Connection
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : isEditing ? "Update" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
      {pendingDbTypeChange && (
        <ConfirmDialog
          title="Replace custom port?"
          message={`Switching from ${form.db_type} to ${pendingDbTypeChange.to} will reset port ${form.port} → ${DATABASE_DEFAULTS[pendingDbTypeChange.to]}. Continue?`}
          confirmLabel={`Use default port ${DATABASE_DEFAULTS[pendingDbTypeChange.to]}`}
          onConfirm={handleConfirmDbTypeReplace}
          onCancel={handleCancelDbTypeReplace}
        />
      )}
    </Dialog>
  );
}
