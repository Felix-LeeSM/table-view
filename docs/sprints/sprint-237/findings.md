# Sprint 237 — Fixture Data Workflow Vertical Slice — Evaluator Findings

Date: 2026-05-10
Commit under review: `38ba73d` ("feat(fixtures): development + e2e profile fixture compiler vertical slice")
Contract: `docs/fixture-data-workflow-handoff.md` (locked at `154a1ff`)

## Sprint 237 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** (35%) | 7/10 | Core flow works (56,200 rows in 5.4s; 17/17 unit tests pass; smoke generate prints valid JSON for 3 entities). FK ordering, PK uniqueness across locales, and unique-column edge gating are correctly implemented. **Two real defects:** (1) `pickEdgeValue` excludes the `very_long` edge category whenever `max_length < 2048`, instead of "or truncate to limit" per handoff §Edge Integrity Guards — i.e. for `full_name` (max_length 200), `subject` (200), `body` (5000), the very_long edge is unreachable, so the test claim "incl. truncated edge values" is vacuously true. (2) Nullable FKs (`support_tickets.customer_id`) are NEVER null in practice — `generateNormalValue` for `ref` always picks a real parent row, and `isEdgeEligible` excludes FKs from edge injection, so nullable-FK NULL handling is silently never exercised by the fixture. |
| **Completeness** (25%) | 8/10 | All 29 locked decisions inspected are present: 2 profiles + 5 entities + 4 PG schemas + Mongo embed kind:many; just-in-time `CREATE DATABASE` via system DB; topo-sort FK ordering; plaintext `connections.json` upsert under `fixture-` prefix + `Fixtures` group; `--target pg|mongo|all` + `--quiet`; corruption refusal; session-termination before `DROP DATABASE`; mongo volume added to `docker-compose.yml`. **Out-of-spec deviation:** handoff §Fixture Compiler line 124 specifies `./scripts/wait-for-test-db.sh` for `db:up`, but implementation uses a new `./scripts/db/wait.sh` (the original references stale container names per its own comment, so the deviation is justified — but it is a contract drift that should be re-locked, not a silent override). |
| **Reliability** (20%) | 6/10 | Good: corruption refusal, atomic write + chmod 600, `pg_terminate_backend` before drop, partial-failure error message references `db:reset` recovery. **Gaps:** (a) `shapeDocument` in `mongo.ts` runs `childRows.filter(...)` per parent row → O(parents × children) per embed = ~432M comparisons for development orders/order_items; the 8.4s mongo seed is dominated by this. Should pre-bucket children by FK once. (b) `applyMongo` computes `embedSources` and immediately discards it via `void embedSources` (line 104) — dead code that suggests an unfinished refactor; the actual filter is implicit via `targets` declarations on child entities. (c) Multiple `void <var>;` markers (`index.ts:249`, `mongo.ts:104`, `postgres.ts:155`, `postgres.ts:184`) are residue from cleanup; pass lint but signal incomplete work. (d) `stripIdShape` is a no-op (`{ ...rest } = r` with no key omission) despite the name suggesting it strips something. |
| **Verification Quality** (20%) | 6/10 | 17/17 vitest pass; tsc + eslint clean; runtime evidence captured at 4 profile×target combinations. **Gaps in test coverage:** (a) **No test for Mongo embed shaping** — the kind:many vs kind:one distinction (handoff Decision 26) is the most novel mechanic and has zero unit coverage. (b) **No test for `connections.ts` upsert / clear semantics** — `Fixtures` group creation, `fixture-` prefix filter on clear, group auto-deletion when no fixture-* connections remain — none asserted. (c) **No test for `postgres.ts` DDL** (CREATE TABLE generation, FK constraint, varchar vs text mapping for max_length, `coerceForPg` array/json coercion). (d) **No negative test for `locale_mix` sum mismatch** — handoff lock is asserted only positively. (e) Determinism test is too narrow — only verifies first row's id/email/full_name/sku, not the full dataset hash. (f) No test verifies edge values actually appear (e.g. assert at least one row has emoji/RTL when locale_mix.edge > 0). |
| **Overall** | **7.0/10** | Weighted: Correctness 7×0.35 + Completeness 8×0.25 + Reliability 6×0.20 + Verification 6×0.20 = 2.45 + 2.0 + 1.2 + 1.2 = 6.85, rounds to 7.0. |

## Verdict: PASS (with required follow-up)

The vertical slice is functional, the core invariants are guarded, and the locked decisions are honored. PASS contingent on the follow-up findings below being addressed in Sprint 238 — none of them block daily-dev usability of the development profile, but the Mongo perf hot path will bite at any scale beyond current development sizes and the `very_long` edge gap silently weakens fixture coverage for one of the six declared edge categories.

## Sprint Contract Status (Done Criteria — handoff §Implementation Order #1)

- [x] **`base.yaml` + `profiles/development.yaml` + `profiles/e2e.yaml`** — verified: 5 entities, 4 PG schemas, Mongo embed declared, both profiles parse + validate, locale_mix sums to 1.0.
- [x] **TypeScript CLI under `scripts/fixtures/` for PostgreSQL and MongoDB** — verified: `index.ts` dispatches seed/reset/connections/generate; `postgres.ts` + `mongo.ts` apply via pg + mongodb clients.
- [x] **bash wrappers / pnpm scripts for `db:up` / `db:down`** — verified: `package.json` has 6 db:* scripts; `scripts/db/wait.sh` waits for both healthchecks. **Note:** uses new wait script path, not handoff's `./scripts/wait-for-test-db.sh` — justified by stale-container-name comment but is a contract drift.
- [x] **Fixture connection direct upsert (plaintext) for both profiles** — verified: `connections.ts` writes `~/Library/Application Support/table-view/connections.json` with `Fixtures` group + `fixture-` prefix + plaintext password + chmod 600. Corruption refused.
- [x] **Mongo volume added to `docker-compose.yml`** — verified: `mongodata:/data/db` mount + top-level `volumes: mongodata:` declaration present in commit.
- [x] **Just-in-time `CREATE DATABASE IF NOT EXISTS` via system `postgres` DB** — verified: `ensurePgDatabase` connects to system `postgres` DB, probes `pg_database`, runs `CREATE DATABASE` only if missing.
- [x] **`db:up`, `db:seed`, `db:reset`, `db:connections`, `db:generate` package.json scripts** — verified: all 5 + `db:down` present.
- [x] **5 entities, 4 PG schemas** — verified: customers/products/orders/order_items/support_tickets across core/catalog/sales/support.
- [x] **Mongo `embed` semantics** — verified for `kind: many` (orders.items embedded as array of order_items, with order_items.targets=[pg] only so no standalone collection). **No test coverage** for kind:one (none in spec yet, but the code path exists).
- [~] **Edge integrity gating (PK never edge, unique columns get no fixed-string edges, max_length truncation)** — partially: PK exclusion ✓, unique exclusion ✓, **max_length truncation broken** for very_long (excludes instead of truncating when max_length < 2048; truncation branch is dead code in current spec).
- [x] **Topological FK ordering** — verified by unit test + cyclic detection negative test.
- [x] **`--target pg|mongo|all` flag, `--quiet` flag** — verified in `index.ts` parser.

## Feedback for Generator (actionable, prioritized)

1. **[Correctness — Edge Integrity]**: Fix `pickEdgeValue` very_long branch to truncate, not exclude, when `max_length` is set.
   - Current: `if (!c.maxLength || c.maxLength >= EDGE_LONG.length) candidates.push(["very_long", EDGE_LONG]);` excludes very_long for any column with `max_length < 2048`. The downstream truncation block becomes dead code.
   - Expected: per handoff §Edge Integrity Guards "very_long: max_length set (or truncate to limit)" — very_long should always be a candidate for non-unique string columns; the existing post-pick truncation handles the limit.
   - Suggestion: Remove the `c.maxLength >= EDGE_LONG.length` gate so every non-unique string column with `max_length` set actually exercises the truncated very_long edge in the seeded data.

2. **[Correctness — Nullable FK]**: Inject NULL into nullable FK columns at a configurable rate.
   - Current: `generateNormalValue` for `ref` always returns a real parent row id; `isEdgeEligible` excludes FKs from edge injection; net effect is nullable FKs are never NULL.
   - Expected: handoff §Edge Integrity Guards "FK columns: only null is allowed (when nullable: true)" implies NULL FK is a valid value class, not just a fallback when targets are empty.
   - Suggestion: When `col.nullable && col.type === "ref"`, draw NULL with a small probability (e.g. 5–10%) on edge rows, or expose a `null_rate` per-column knob. This is the only path by which the generator currently exercises NULL-FK handling in the DB client.

3. **[Reliability — Mongo perf]**: Pre-bucket child rows by FK before embed shaping.
   - Current: `shapeDocument` runs `childRows.filter((cr) => cr[fkCol] === row.id)` per parent → O(parents × children) per embed (~432M ops for development orders/order_items).
   - Expected: O(children + parents) by indexing once.
   - Suggestion: Build `Map<parentId, ChildRow[]>` once per embed at the top of `applyMongo`, look up `map.get(row.id) ?? []` instead of filter. Likely brings the 8.4s mongo seed to <2s and unblocks scaling toward larger profiles.

4. **[Verification — Mongo embed]**: Add unit tests for `shapeDocument` cardinality.
   - Current: zero tests for the kind:many vs kind:one branch.
   - Expected: handoff Decision 26 is novel ("auto-inference rejected, cardinality is explicit") and merits a regression guard.
   - Suggestion: New test file `scripts/fixtures/mongo.test.ts`. Build a tiny in-memory `EntityRows` fixture and assert (a) kind:many produces an array, (b) kind:one with one matching child produces an object, (c) kind:one with no match produces null, (d) embedded child entities preserve their `id` field.

5. **[Verification — connections.ts]**: Add unit tests for upsert / clear semantics.
   - Current: `connections.ts` has zero unit coverage despite `__test` seam being exposed.
   - Expected: handoff §Fixture Connections lists 6 invariants (group "Fixtures", `fixture-` prefix, upsert by id, clear only `fixture-*`, preserve order, plaintext password). Each is a regression target.
   - Suggestion: Use `TABLE_VIEW_TEST_DATA_DIR` env override (already supported in code) to point storage at a tmp dir; assert (a) first upsert creates `Fixtures` group + adds N connections, (b) second upsert with same ids updates not duplicates, (c) clear removes only `fixture-*`, leaves user-added connections untouched, (d) clear preserves `Fixtures` group when a non-fixture-* connection still references it, deletes group when empty, (e) corrupt JSON throws specific quarantine message.

6. **[Cleanup — dead markers]**: Remove `void <var>;` residue + unused `embedSources`.
   - Current: 4 `void` markers across `index.ts`, `mongo.ts`, `postgres.ts`. `applyMongo` computes `embedSources` and discards it. `stripIdShape` is a no-op clone.
   - Expected: Either each variable serves a purpose or it's deleted.
   - Suggestion: Delete `embedSources` (`targets` already gates standalone-collection writes correctly). Remove `void target;` from `main()` (each branch already destructures). Inline `stripIdShape` to `{ ...r }` or actually omit a key (e.g. `_id` if any embedded child carries one) so the function name matches behavior.

7. **[Verification — locale_mix negative path]**: Add a test that asserts `locale_mix sum != 1.0` rejects with the documented message.
   - Current: positive load tests only.
   - Suggestion: Construct a fake profile via `parseYaml` + zod schema, or extract `validateCoherence` for direct testing; assert `loadSpec` throws `/locale_mix must sum to 1.0/`.

8. **[Verification — determinism]**: Tighten the determinism guard.
   - Current: only checks first row's 4 fields.
   - Suggestion: Hash the full sorted dataset (e.g. SHA-256 of `JSON.stringify(rows)` minus timestamp columns) and pin it. Catches RNG-stream order regressions across the entire generator.

9. **[Contract drift]**: Either rename `scripts/db/wait.sh` to match handoff `./scripts/wait-for-test-db.sh`, or amend the handoff with a one-line note explaining the new path replaces the legacy script.
   - Current: `db:up` invokes `./scripts/db/wait.sh`; handoff line 124 says `./scripts/wait-for-test-db.sh`.
   - Suggestion: Add a note to `docs/fixture-data-workflow-handoff.md` (the only acceptable amendment per memory palace ADR rule, since it's a path detail not a decision) or accept the deviation as-is and document it in `memory/lessons/` so future readers don't trip on the discrepancy.
