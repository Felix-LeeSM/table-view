// Shared SQL identifier validation for the schema dialogs.
//
// Issue #1626 (2026-07-22): the same validation (trim → empty → UTF-8
// byte length → identifier regex) was triplicated across
// RenameTableDialog / AddColumnDialog / CreateTriggerDialog, which drove
// a P1 test-drift — the same reject matrix was re-asserted in two
// component suites. Extracting one `label`-parameterised implementation
// lets the matrix be verified once (identifier.test.ts) and each dialog
// keep only a representative wire-up case.

/** Unquoted identifier: letter/underscore start, then alphanumeric/underscore. */
export const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Max identifier length in bytes (Postgres NAMEDATALEN - 1). */
export const IDENTIFIER_MAX_BYTES = 63;

/**
 * Validate a user-entered SQL identifier. Returns a `label`-prefixed
 * error message when invalid, or `null` when valid. `label` supplies the
 * domain noun ("Table name", "Column name", …) so one implementation
 * serves every dialog.
 */
export function validateIdentifier(
  value: string,
  label: string,
): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return `${label} must not be empty`;
  }
  // Byte length — stay UTF-8 safe by encoding before measuring.
  if (new TextEncoder().encode(trimmed).length > IDENTIFIER_MAX_BYTES) {
    return `${label} must not exceed ${IDENTIFIER_MAX_BYTES} bytes`;
  }
  if (!IDENTIFIER_RE.test(trimmed)) {
    return `${label} must start with a letter or underscore and contain only alphanumeric characters and underscores`;
  }
  return null;
}
