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
 *
 * Sprint 213 — body relocated from `ConnectionDialog.tsx` into
 * `ConnectionDialog/sanitize.ts`. The entry re-exports the same
 * identifier so `import { sanitizeMessage } from
 * "@components/connection/ConnectionDialog"` continues to work for
 * external callers. Function body is byte-identical to the pre-split
 * version (replaceAll + URL-encoded variant masking) — refactor only.
 */
/**
 * Issue #1453 — pattern-based masks that need no known secret. The sidebar
 * status path (connection store → `ConnectionItem`) never has the plaintext
 * password in scope (the backend sends `hasPassword: boolean` only), so the
 * secret-literal pass above cannot cover it. Both patterns mirror the Rust
 * backend's `redact_connection_message` (`storage/sql_redact.rs`):
 *  - URI userinfo `://user:secret@` (user part may be empty — Redis URLs).
 *  - key=value `password=...` / `pwd=...` (ADO / libpq style). An unquoted
 *    value stops at separators; a single-/double-quoted value (libpq
 *    conninfo `password='x y'`, review #1490 B2) is masked whole, quotes
 *    included, so spaces inside the quotes can't split the secret.
 */
const URI_USERINFO_RE = /(:\/\/[^/?#\s:@']*:)[^@\s/']+@/g;
const KV_CREDENTIAL_RE =
  /\b((?:password|pwd)\s*=\s*)('[^']*'|"[^"]*"|[^;&\s'"]+)/gi;

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
  return out
    .replace(URI_USERINFO_RE, "$1***@")
    .replace(KV_CREDENTIAL_RE, "$1***");
}
