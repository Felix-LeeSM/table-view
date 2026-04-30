# Sprint 178 — Findings (Generator)

Sprint 178 applies Postel's Law to `ConnectionDialog`: the form-mode host
field accepts a connection URL paste (8 schemes), trims user-pasteable
non-password string fields at the save/test boundary, and splits a
`host:NNNN` shorthand on blur. Malformed URL pastes are silently
absorbed (no toast / no `role="alert"` / no `role="status"` added). No
password substring (raw or URL-encoded) ever lands in any
`role="alert"` / `role="status"` / `aria-live` region.

## Mechanism notes

### Detection trigger: `onPaste` (delegated)

The form-mode wrapper at `ConnectionDialog.tsx:598` (the `inputMode === "form"`
branch) carries the `onPaste` and `onBlur` handlers. The handlers
short-circuit on any target other than `#conn-host`, so other inputs
(`#conn-name`, `#conn-user`, `#conn-database`, `#conn-password`,
`#conn-port`) are unaffected. We chose `onPaste` over `onChange`
because:

- A user typing a host like `db.example.com` would otherwise hit
  near-misses in any `://` heuristic mid-stream.
- Paste is the most explicit user-intent moment; the user is asking
  the form to absorb a clipboard payload.
- Single-shot guarantee: `e.preventDefault()` is called only after a
  successful `parseConnectionUrl`, so malformed pastes fall through to
  the default browser behavior (the literal text lands in the host
  field, exactly what AC-178-04 requires).

The handler reads `e.clipboardData.getData("text")` per the React
synthetic-event API. `looksLikeRecognisedUrl` gates the URL parser to
strings that start with one of the 8 recognized scheme prefixes
(`postgres`, `postgresql`, `mysql`, `mariadb`, `mongodb`, `mongodb+srv`,
`redis`, plus the `sqlite:` URL form). A pasted free-form note that
happens to contain `://` (per spec §C.4) is rejected at this gate
because it does not start with a recognized scheme.

### Trim location: save/test boundary via `trimDraft`

`ConnectionDialog.tsx:256-263` defines:

```ts
const trimDraft = (draft: ConnectionDraft): ConnectionDraft => ({
  ...draft,
  name: draft.name.trim(),
  host: draft.host.trim(),
  database: draft.database.trim(),
  user: draft.user.trim(),
});
```

The list is **explicitly enumerated** so a future field added to
`ConnectionDraft` (e.g. an SSH key path or a Mongo replica set name) is
not silently trimmed unless someone deliberately adds it. `password` is
preserved via the `...draft` spread — the helper does not mention
`password` at all, satisfying ADR-0005 and the contract's password-trim
guard. `group_name` does not currently exist on `ConnectionDraft`; if
introduced (per AC-178-02 "if present in the draft"), it would be added
to the trim list at the same time the field is added.

Trim is applied in `handleSave` (line 295) and `handleTest` (line 272–278).
**Not** applied on keystroke: a user typing leading whitespace into a
field stays able to. Validation in `handleSave` uses the trimmed copy,
so a user who types `"   "` into Name still gets the "Name is required"
error (consistent with the existing `form.name.trim()` validation
that this sprint replaced).

### Host:port split rule on blur

`ConnectionDialog.tsx:408-426` uses the regex `/^([^[:][^:]*):(\d+)$/`.
The pattern means:

- The host part starts with a character that is NOT `[` (rejects
  bracketed IPv6 like `[::1]:5432`) and NOT `:` (rejects bare IPv6
  like `::1:5432`).
- The host part contains zero or more characters that are NOT `:`
  (rejects multi-colon strings).
- Followed by exactly one `:` and then one or more digits.

This rejects:

- `[::1]:5432` (first char `[`)
- `fe80::1` (multiple colons in the host portion)
- `::1:5432` (first char `:`)
- `db.example.com:abcd` (non-digit suffix)

It accepts: `localhost:5433`, `db.example.com:5432`, `192.168.1.1:3306`.

The split fires on `onBlur` (delegated through the form wrapper). On
blur of `#conn-host`, if the regex matches, the form's `host` is set
to the captured group 1 and `port` to `parseInt(group 2, 10)`.
Non-matching values are left untouched.

### Affordance: inline `<p data-testid="connection-url-detected">`

After a successful URL paste, `detectedScheme` state holds the parsed
`db_type`. The dialog renders an inline note immediately after the
DBMS-specific form fields (`ConnectionDialog.tsx:699-705`) reading
`Detected <scheme> URL — fields populated.` with `text-2xs
text-muted-foreground` matching the existing URL-mode help-text tone.

Critically, the affordance is **NOT** a `role="alert"`, `role="status"`,
or `aria-live` region — those roles trigger AT announcements that would
be over-eager for advisory feedback. AC-178-04 (silent on malformed
pastes) and AC-178-05 (no password leak in alerts) both require this:
the AC-178-05 guard walks every alert/status/aria-live region, and the
affordance must NOT be in any of those buckets so the test can
interpret a count of zero as "no leak."

The affordance state is not auto-cleared on subsequent host edits.
Stale-affordance is acceptable because (a) it's purely advisory text
and (b) re-pasting another URL replaces `detectedScheme` to the new
scheme.

### Password leak guard: `sanitizeMessage`

`ConnectionDialog.tsx:80-127` defines a module-scope `sanitizeMessage`
helper (function declared at line 95 with the comment block above). It accepts the raw error message and zero or more secrets,
replacing each non-empty secret (and its `encodeURIComponent` form, if
distinct) with `***`. Used at three call sites:

1. `handleTest` catch (line 285): test-feedback aria-live region.
2. `handleSave` catch (line 329): the `role="alert"` save-error region
   in the dialog footer.
3. (No third site exists — `setUrlError` is on the URL-mode toggle path
   which is out of scope; that path's "Invalid URL" copy is a static
   string that cannot leak the password.)

Secrets passed are `passwordInput` (the user's current password input
state) and `form.password` (the form-level password — typically `null`
in editing mode, or the value from a paste-detected URL). Both are
replaced literal-substring (not regex) so no regex meta-character in
the password could accidentally bypass the mask.

### `parseConnectionUrl` extension

`src/types/connection.ts:212-228`. The scheme map is extended:

```ts
const dbTypeMap: Record<string, DatabaseType> = {
  postgresql: "postgresql",
  postgres: "postgresql",
  mysql: "mysql",
  mariadb: "mysql",            // NEW (Sprint 178)
  mongodb: "mongodb",
  "mongodb+srv": "mongodb",    // NEW (Sprint 178)
  redis: "redis",
};
```

`mongodb+srv` and `mariadb` are URL-scheme aliases — they do not
introduce new `DatabaseType` variants. The `DATABASE_DEFAULTS`,
`DATABASE_DEFAULT_FIELDS`, `paradigmOf`, and `assertNever` exhaustive
switch in `ConnectionDialog.renderDbmsFields` are all unchanged.

A second tightening: `parseConnectionUrl` now returns `null` when
`parsed.hostname` is empty (e.g. `postgres://`, `mysql://@`,
`mongodb+srv://`, `mariadb://@/`). Previously it returned a partial
draft with `host: "localhost"`, which would have caused AC-178-04 to
populate the form on a malformed paste. The form-mode paste handler
relies on this `null` return to leave the host field untouched.

## Error-display sanitisation audit

| Call site | File | Line | Sanitised? | Why |
|---|---|---|---|---|
| `setError(...)` (validation: name required) | `ConnectionDialog.tsx` | 297 | Static copy, no leak vector | Hardcoded `"Name is required"`. |
| `setError(...)` (validation: host required) | `ConnectionDialog.tsx` | 303 | Static copy | Hardcoded `"Host is required"`. |
| `setError(...)` (validation: db file required) | `ConnectionDialog.tsx` | 307 | Static copy | Hardcoded `"Database file is required"`. |
| `setError(sanitizeMessage(String(e), ...))` (save catch) | `ConnectionDialog.tsx` | 329 | **Yes** | Backend `e` could echo connection string. |
| `setTestResult({status:"error", message: sanitizeMessage(String(e), ...)})` | `ConnectionDialog.tsx` | 285 | **Yes** | Same. |
| `setUrlError(...)` (URL-mode `Parse & Continue` invalid URL copy) | `ConnectionDialog.tsx` | 575 | Static copy | Hardcoded copy with no password substring. URL-mode is out of sprint-178 scope per Invariants. |
| `urlError` div with `role="alert"` (URL-mode) | `ConnectionDialog.tsx` | (URL-mode block) | Static copy | Same as above; URL-mode static error copy. |

Conclusion: every dynamic error path (where the message string can
include backend-emitted text) routes through `sanitizeMessage`. Static
copy paths cannot leak by construction.

## Browser smoke summary

Browser smoke is **operator-driven** per the contract's mixed
verification profile. The Generator did not launch `pnpm tauri dev`
because:

1. The new behaviour is fully covered by Vitest assertions (24 new
   sprint-178 tests + 11 new parser tests, all green).
2. The operator can replay the smoke steps using the manual replay
   list in the contract §Verification Plan #6.

**Recommended Evaluator smoke steps** (replay):

1. `pnpm tauri dev`. Open `New Connection`.
2. Paste `postgres://u:pwxx@h:1234/db` into the host field. Confirm:
   `db_type` switches to `PostgreSQL`, `Host=h`, `Port=1234`, `User=u`,
   `Database=db`, the inline note `Detected postgresql URL — fields
   populated.` appears below the DBMS fields. The literal URL is NOT
   left in the host field.
3. Paste `mongodb+srv://user:secret@cluster.example.com/mydb`. Confirm:
   `db_type=MongoDB`, `Host=cluster.example.com`, `Port=27017` (default),
   `User=user`, `Database=mydb`. SRV-specific note: the backend
   resolves the SRV record at connect time; the frontend preserves the
   hostname as-is.
4. Type `localhost:5433` into the host field, blur. Confirm
   `Host=localhost`, `Port=5433`.
5. Type `[::1]:5432` into the host field, blur. Confirm
   `Host=[::1]:5432` (unchanged), Port unchanged.
6. Save a connection with `Name="  My DB  "`, `Host="  localhost  "`.
   Re-open the saved connection. Confirm the saved values are
   `Name="My DB"` and `Host="localhost"` (whitespace stripped).

**Skipped scheme**: live `mongodb+srv://` smoke would require DNS
resolution and a reachable cluster; the AC-178-01 mongodb+srv path is
exercised only at the parser + form-population layer in unit tests.
This is an acknowledged gap (see Residual Risks).

## Evidence index

| AC | Test file | Test name(s) |
|---|---|---|
| AC-178-01 | `src/components/connection/ConnectionDialog.sprint178.test.tsx` | `[AC-178-01] form-mode host paste detection › paste of <scheme> URL populates form in one step + shows affordance` (8 schemes) + `empty paste is a no-op` |
| AC-178-01 | `src/types/connection.test.ts` | `parses mongodb+srv URL …`, `parses mariadb URL …`, `decodes URL-encoded password for …`, `returns null for unrecognised scheme like cockroachdb://` |
| AC-178-02 | `src/components/connection/ConnectionDialog.sprint178.test.tsx` | `[AC-178-02] save-time trim of non-password string fields › trims name / host / database / user; password sent verbatim` + `trim also applies on Test Connection` |
| AC-178-03 | `src/components/connection/ConnectionDialog.sprint178.test.tsx` | `[AC-178-03] host:port blur split › [AC-178-03a] localhost:5433 splits …`, `[AC-178-03b] [::1]:5432 …`, `[AC-178-03b] fe80::1 …`, `[AC-178-03c] db.example.com:abcd …` |
| AC-178-04 | `src/components/connection/ConnectionDialog.sprint178.test.tsx` | `[AC-178-04] malformed URL paste is silent › malformed paste "<url>" leaves host unchanged + adds no alert/status region` (4 URLs) |
| AC-178-04 | `src/types/connection.test.ts` | `returns null for postgres://`, `returns null for mysql://@`, `returns null for mongodb+srv://`, `returns null for mariadb://@/`, `returns null for host:port-only input` |
| AC-178-05 | `src/components/connection/ConnectionDialog.sprint178.test.tsx` | `[AC-178-05a] password absent from all alerts after URL paste`, `[AC-178-05b] password absent from test-feedback after backend echoes connection string`, `[AC-178-05b] password absent from save-error alert after backend echoes connection string`, `[AC-178-05] URL-encoded password also masked in save-error alert` |

### Per-scheme paste assertion table (AC-178-01)

| Scheme | URL | Expected db_type | Expected host | Expected port | Expected user | Expected db | Expected pw |
|---|---|---|---|---|---|---|---|
| postgres | `postgres://u:p@h:1234/db` | `postgresql` | `h` | `1234` | `u` | `db` | `p` |
| postgresql | `postgresql://admin:s3cret@db.example.com:5432/myapp` | `postgresql` | `db.example.com` | `5432` | `admin` | `myapp` | `s3cret` |
| mysql | `mysql://root:rpw@mysql.local:3306/store` | `mysql` | `mysql.local` | `3306` | `root` | `store` | `rpw` |
| mariadb | `mariadb://app:apw@maria.local:3307/inv` | `mysql` | `maria.local` | `3307` | `app` | `inv` | `apw` |
| mongodb | `mongodb://mu:mp@mongo.local:27018/logs` | `mongodb` | `mongo.local` | `27018` | `mu` | `logs` | `mp` |
| mongodb+srv | `mongodb+srv://srvu:srvp@cluster.example.com/mydb` | `mongodb` | `cluster.example.com` | `27017` (default) | `srvu` | `mydb` | `srvp` |
| redis | `redis://rediu:redip@redis.local:6379/0` | `redis` | `redis.local` | `6379` | `rediu` | `0` (db index) | `redip` |
| sqlite | `sqlite:/data/app.sqlite` | `sqlite` | (no host field) | (no port field) | (no user field) | `/data/app.sqlite` | (no pw field) |

### Outgoing-payload trim/verbatim assertion (AC-178-02)

The `[AC-178-02] save-time trim` test sets:
- `name="  My DB  "`, `host="  localhost  "`, `user="  admin  "`, `database="  testdb  "`, `password="  secret  "`

Then asserts the outgoing `addConnection` mock invocation receives:
- `name="My DB"`, `host="localhost"`, `user="admin"`, `database="testdb"` (all trimmed)
- `password="  secret  "` (verbatim — whitespace preserved)

### Host:port split decision rows (AC-178-03)

| Input | Match? | Outcome |
|---|---|---|
| `localhost:5433` | Yes | host=`localhost`, port=`5433` |
| `db.example.com:5432` | Yes (parser-level) | host=`db.example.com`, port=`5432` |
| `[::1]:5432` | No (first char `[`) | unchanged |
| `fe80::1` | No (multiple `:` in host) | unchanged |
| `::1:5432` | No (first char `:`) | unchanged |
| `db.example.com:abcd` | No (non-digit port) | unchanged |

### Alert-count baseline-vs-after-paste (AC-178-04)

For each of `postgres://`, `mysql://@`, `mongodb://`, `mariadb://`:

- Capture `screen.queryAllByRole("alert").length` and
  `screen.queryAllByRole("status").length` before paste.
- Paste the malformed URL.
- Re-query. Assert both counts are unchanged.

### Walk-all-alerts assertion (AC-178-05)

`assertNoPasswordLeak(secret)` selects every node matching:

```ts
[...document.querySelectorAll('[role="alert"]')]
  .concat([...document.querySelectorAll('[role="status"]')])
  .concat([...document.querySelectorAll("[aria-live]")])
```

For each, asserts `node.textContent` does NOT contain `secret` AND
(if `encodeURIComponent(secret) !== secret`) does NOT contain the
encoded form. Used in the four AC-178-05 tests covering paste,
test-error, save-error, and URL-encoded variants.

## Existing-test rewrites

None. The existing `ConnectionDialog.test.tsx` (69 cases) passes
unchanged after the sprint-178 changes. The existing parser test file
(`connection.test.ts`) gained 11 new cases without touching existing
ones.

## Assumptions

- **Detection trigger**: `onPaste` (not `onChange`). Justified above.
- **Parser extension**: extended in place at `connection.ts:212-228`
  rather than extracted to `src/lib/connection/urlParser.ts`. Reason:
  the change is a 4-line scheme map addition + a 1-line null guard;
  extracting to a new module would not improve clarity and would
  create a cross-file refactor that is out of scope for the AC.
- **Trim helper location**: inlined as a `const trimDraft` inside the
  component because (a) the closure over `ConnectionDraft` keeps the
  type local to the dialog and (b) the helper is not currently shared
  with any other dialog. Future SSH-fields-aware version could be
  promoted to `src/types/connection.ts` if a second consumer arrives.
- **Affordance shape**: inline `<p>` rendered after the DBMS fields,
  not a toast. Reason: there is no toast surface in this dialog; a
  toast would need new infrastructure outside scope.
- **Affordance copy**: `Detected <scheme> URL — fields populated.`
  Single sentence, declarative, no exclamation. Matches the existing
  URL-mode help text tone.
- **`detectedScheme` reset policy**: not auto-cleared on subsequent
  edits. The note is purely advisory and stale-affordance is benign.
- **`parseConnectionUrl` null-on-empty-host change**: previously it
  returned a partial draft with `host: "localhost"` — that fallback
  was unsafe for the form-mode paste path (would mistakenly populate
  a draft from a malformed URL). The fallback was removed. No
  existing caller depends on the localhost fallback (the URL-mode
  `Parse & Continue` path also benefits from the tighter null
  semantic — `Invalid URL` is now surfaced when the paste is empty).

## Residual risk / verification gaps

- **Live `mongodb+srv` smoke**: not exercised end-to-end because SRV
  needs DNS + a reachable cluster. Unit tests cover the parser leg
  and the form-population leg; the Mongo URI itself is a
  backend-driver concern (no frontend code change needed).
- **Other consumers of `parseConnectionUrl`**: a `grep -rn` shows the
  helper is consumed only by `ConnectionDialog.tsx:401` (URL-mode
  Parse & Continue) and the new form-mode paste handler. The
  null-on-empty-host tightening means URL-mode now also surfaces
  `Invalid URL` when the user pastes `postgres://`; that is consistent
  with the existing copy.
- **`cockroachdb://` and other unknown schemes**: still fall through
  to `null` (same as today's `redis-cluster://` etc.). No change in
  semantics.
- **jsdom paste limitation**: jsdom does not implement default browser
  paste behaviour, so unit tests cannot directly assert "the literal
  URL did NOT land in the host field after a successful paste."
  The successful-paste branch calls `e.preventDefault()` before
  setting form state from the parsed URL; we instead assert that the
  resulting host equals `parsed.host` (e.g. `h`, not the literal
  pasted URL). The Evaluator's browser smoke covers the
  preventDefault behaviour in real browsers.
- **`window-lifecycle.ac141.test.tsx:173` known pre-existing failure**:
  unrelated to sprint 178. Documented in the execution brief as
  out-of-scope.

## Coverage check

The two touched source files (`src/types/connection.ts` and
`src/components/connection/ConnectionDialog.tsx`) gained:

- `connection.ts`: 4 changed lines for the scheme map + 2-line null
  guard (out of 285 total lines). All 4 lines covered by parser tests.
- `ConnectionDialog.tsx`: 1 module-scope helper (`sanitizeMessage`,
  ~15 LOC) + 1 useState hook + `trimDraft` + 2 event handlers
  (`handleHostPaste`, `handleHostBlur`) + the affordance JSX. All
  lines covered by the 24 new sprint-178 tests; the catch-block
  sanitisation is exercised by the AC-178-05b/AC-178-05 URL-encoded
  variants.

Project convention is ≥ 70% line coverage on touched code. The
sprint-178 surface is ~50 new lines of behavior; all are exercised.
</content>
</invoke>