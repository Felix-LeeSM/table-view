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
 *                  so the dialog saves without it, and what it changes is how
 *                  an already-established connection behaves (timeouts,
 *                  keep-alive, read-only enforcement, Mongo's auth source /
 *                  replica set). A fallback is not a promise the server accepts
 *                  it — Mongo's auth source falls back to the connection
 *                  database, so a deployment whose user lives in `admin` still
 *                  has to come here.
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
