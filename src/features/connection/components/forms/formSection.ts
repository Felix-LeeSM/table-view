/**
 * Issue #2436 — which segment of the connection dialog a form control belongs
 * to. `ConnectionDialogBody` renders one segment at a time, and each DBMS form
 * component receives the segment being rendered.
 *
 * The split is a rule, not a per-DBMS list of field names. A list re-splits
 * every time a DBMS is added; the rule survives:
 *
 *   - `basic`    — every field `validateConnectionDraft` can reject, plus the
 *                  controls that decide what one of those fields *means*
 *                  (Oracle's service/SID method, MSSQL's auth method). Its
 *                  shape is therefore fixed by the validator, not by how many
 *                  DBMSes exist.
 *   - `advanced` — settings the validator never rejects: each has a fallback,
 *                  so the dialog saves without it, and none of them is one of
 *                  the host / port / user / password / database controls every
 *                  form draws in `basic` (timeouts, keep-alive, read-only
 *                  enforcement, Mongo's auth source / replica set). Several are
 *                  read while the connection is being made, not after it: the
 *                  auth source becomes `Credential.source` for the
 *                  authentication handshake and the replica set becomes
 *                  `ClientOptions::repl_set_name`
 *                  (src-tauri/table-view-core/src/db/mongodb/connection.rs
 *                  `build_options`), and the timeout is the dial budget. A
 *                  fallback is not a promise the server accepts it — Mongo's
 *                  auth source falls back to the connection database, so a
 *                  deployment whose user lives in `admin` still has to come
 *                  here.
 *   - `security` — transport security: TLS on/off, verification posture,
 *                  certificate trust, wallet. An SSH tunnel lands here when
 *                  one is built — no SSH field exists anywhere today.
 *
 * The `basic` half of that rule is load-bearing, not descriptive: it is what
 * keeps a rejected field reachable. `ConnectionDialog` switches to `basic`
 * before focusing the flagged input, and because the validator can only flag
 * fields that live there, the input is always mounted by the time it focuses.
 */
export type ConnFormSection = "basic" | "advanced" | "security";
