/**
 * Issue #1135 — connection form validation-state exposure.
 *
 * `ConnectionDialog.handleSave` validates Name / Host / Database and renders a
 * single footer banner (`role="alert"`, id `CONNECTION_ERROR_ID`). To let
 * screen-reader users know *which* field failed, the offending input needs
 * `aria-invalid` + `aria-describedby` pointing at that banner, and every
 * required field advertises `required` / `aria-required`.
 *
 * The 8 DBMS form components share the same Host / Database input shape, so
 * rather than copy four aria attributes into each one they spread the props
 * returned here. `MasterPasswordField` is the pattern this generalises.
 *
 * Issue #2437 added `validateConnectionDraft` below: the rule that decides
 * *which* field is missing now lives next to the aria props that expose it,
 * and both Save and Test Connection call it.
 */

import type { ConnectionDraft } from "../../model";
import {
  getMssqlConnectionUnsupportedMessage,
  usesTnsDescriptor,
} from "../../model";

/** Field keys `ConnectionDialog.handleSave` can flag as invalid. */
export type ConnFieldKey = "name" | "host" | "database";

/** id of the shared footer save-error banner (single `role="alert"`). */
export const CONNECTION_ERROR_ID = "connection-form-error";

/**
 * The DBMS-shaped requirement switches, exactly as `useConnectionDraftForm`
 * derives them from `form.dbType`. Passed in rather than re-derived here so
 * the predicates keep a single definition.
 */
export interface ConnDraftShape {
  isFileConnection: boolean;
  isMongo: boolean;
  isSearch: boolean;
}

export interface ConnDraftValidationFailure {
  /**
   * Field to flag with `aria-invalid` and focus, or `null` for a form-wide
   * error that owns no single input (the MSSQL auth-method combos, which
   * `MssqlFormFields` already renders its own inline alert for).
   */
  field: ConnFieldKey | null;
  message: string;
}

/**
 * Issue #2437 — the one required-field rule for a connection draft, shared by
 * Save and Test Connection.
 *
 * Test Connection used to carry only the MSSQL check, so an empty form
 * dispatched the IPC and sat out the driver's 30s timeout (#2429) before
 * saying anything. Both buttons now run this before any request leaves the
 * dialog; keeping it in one function is what stops the two rules drifting
 * apart as DBMS requirements change.
 *
 * @param trimmed already trimmed via `trimDraft` — the checks below must see
 *                the same values the backend would, so a whitespace-only
 *                Name/Host reads as blank (Sprint 178).
 */
export function validateConnectionDraft(
  trimmed: ConnectionDraft,
  { isFileConnection, isMongo, isSearch }: ConnDraftShape,
  t: (key: string) => string,
): ConnDraftValidationFailure | null {
  if (!trimmed.name) {
    return { field: "name", message: t("dialog.errorNameRequired") };
  }
  // File-backed DBMSes use `database` as the file path; host is irrelevant.
  // The host check applies only to network DBMSes.
  //
  // #2154 — an Oracle TNS descriptor carries its own HOST/PORT and the
  // backend dials those, so requiring the form's host too would demand a
  // value nothing reads. `OracleFormFields` disables that input on the same
  // predicate.
  if (!isFileConnection && !usesTnsDescriptor(trimmed) && !trimmed.host) {
    return { field: "host", message: t("dialog.errorHostRequired") };
  }
  if (isFileConnection && !trimmed.database) {
    return {
      field: "database",
      message: t("dialog.errorDatabaseFileRequired"),
    };
  }
  // Sprint 345 — non-SQLite DBMSes also require a database name.
  // Empty submit used to silently default to the server-side fallback
  // (Postgres → `postgres`, Mongo → no DB at all) which surprised users
  // who expected the form's intent to round-trip. The form now seeds
  // a paradigm-appropriate default at draft init, so blank here means
  // the user deleted it on purpose — reject explicitly.
  //
  // Sprint 381 (2026-05-17) — Mongo db-contract α: MongoDB connections
  // do *not* require a default database. The toolbar chip picks the
  // per-tab database at runtime, and admin commands
  // (`db.runCommand({...})`) target the admin DB context regardless of
  // any pre-bound default. RDB connections still require it.
  if (!isFileConnection && !isMongo && !isSearch && !trimmed.database) {
    return {
      field: "database",
      message:
        trimmed.dbType === "oracle"
          ? t("dialog.errorServiceNameRequired")
          : t("dialog.errorDatabaseRequired"),
    };
  }
  const unsupportedMessage = getMssqlConnectionUnsupportedMessage(trimmed);
  if (unsupportedMessage) {
    return { field: null, message: unsupportedMessage };
  }
  return null;
}

/**
 * aria/validation props for one form field.
 *
 * @param fieldKey     the field this input represents
 * @param required     whether `handleSave` requires it for the current DBMS
 * @param invalidField the field the last failed save flagged, or `null`
 */
export function fieldValidationProps(
  fieldKey: ConnFieldKey,
  required: boolean,
  invalidField: ConnFieldKey | null | undefined,
) {
  const invalid = invalidField === fieldKey;
  return {
    required: required || undefined,
    "aria-required": required || undefined,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? CONNECTION_ERROR_ID : undefined,
  };
}
