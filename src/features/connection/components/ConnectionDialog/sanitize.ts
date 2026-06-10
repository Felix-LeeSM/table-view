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
