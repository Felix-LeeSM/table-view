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
 */

/** Field keys `ConnectionDialog.handleSave` can flag as invalid. */
export type ConnFieldKey = "name" | "host" | "database";

/** id of the shared footer save-error banner (single `role="alert"`). */
export const CONNECTION_ERROR_ID = "connection-form-error";

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
