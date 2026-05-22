# Sprint 237 — Handoff Stub

Date: 2026-05-10
Status: PASS (with required follow-up in Sprint 238)

## Sprint identifier
Sprint 237 — Fixture data workflow vertical slice (development + e2e profiles, PG + Mongo).

## Contract
`docs/archives/workflows/fixture-data-workflow-2026-05-09.md` (locked at `154a1ff`).

## Implementation under review
- `38ba73d` — vertical slice (initial commit)
- `a22798a` — password envelope fix (post-evaluator, see "Post-evaluator follow-up" below)

### `38ba73d` files
- `docker-compose.yml` (mongo volume)
- `package.json` + `pnpm-lock.yaml` (db: scripts + faker/pg/mongodb/zod/yaml)
- `scripts/db/wait.sh`
- `scripts/fixtures/{spec,generator,postgres,mongo,connections,index}.ts`
- `scripts/fixtures/{spec,generator}.test.ts`
- `fixtures/base.yaml`, `fixtures/profiles/{development,e2e}.yaml`
- `src/themes.test.ts` (3 unused @ts-expect-error removed; @types/pg pulled in @types/node transitively)

## Verification evidence

### Static / lint / type
- `pnpm tsc --noEmit -p .` — exit 0.
- `pnpm lint` — exit 0.

### Unit tests
- `pnpm vitest run scripts/fixtures` — 17/17 passed in 1.38s (2 test files).

### Smoke
- `pnpm db:generate development --target pg` — emits valid JSON for first 3 entities (customers, products, orders…). Multi-locale visible (Korean name `류지성`, edge `phone: ""`, hanmail.net email).

### Run-time evidence (already captured by generator)
- `pnpm db:reset development --target pg` — 56,200 rows in 5.4s.
- `pnpm db:reset development --target mongo` — 20,200 docs in 8.4s (mongo perf bottleneck — see findings #3).
- `pnpm db:reset e2e --target pg` — ~2,380 rows in 0.9s.
- `pnpm db:reset e2e --target mongo` — 880 docs in 0.3s.

## Score
**7.0/10** (Correctness 7, Completeness 8, Reliability 6, Verification 6).

## Verdict
**PASS** — vertical slice is functional and contract-aligned. Required follow-up tracked in `findings.md` items 1–9; none block daily-dev usage of `pnpm db:reset development`, but #1 (very_long edge unreachable), #2 (nullable FK never NULL), #3 (mongo embed quadratic) should be addressed before scaling to a 750K+ performance profile or shipping a public e2e fixture.

## Post-evaluator follow-up — `a22798a` (password envelope fix)

Sprint 237 PASS verdict was given against `38ba73d` only. Subsequent
manual smoke ("Connect" 클릭) revealed handoff Decision #X ("plaintext
password") collided with the Rust storage contract — every `password`
field on disk MUST be `nonce(12) ‖ ciphertext ‖ gcm_tag(16)` base64
(see `src-tauri/src/storage/crypto.rs::decrypt`). Plaintext made the
app throw "Encryption Error: Ciphertext too short" the moment a user
clicked Connect.

`a22798a` resolves the contract drift inside fixture itself
(`scripts/fixtures/connections.ts`):
- `loadOrCreateAppKey()` reads or auto-generates `<app-data>/.key` —
  matches `crypto::get_or_create_key` byte-for-byte (32 random bytes,
  base64, mode 0600).
- `encryptForStorage()` reproduces the Rust envelope using Node
  `createCipheriv("aes-256-gcm", ...)` with the auth tag explicitly
  appended to ciphertext (Node returns the tag separately; the Rust
  `aes_gcm` crate auto-appends).
- `connections.test.ts` (5 cases, `TABLE_VIEW_TEST_DATA_DIR` isolated)
  guards the Rust↔Node round-trip + key-preservation invariant + clear
  semantics.

Verified: `pnpm db:connections clear && pnpm db:connections upsert
development` then a Node-side `createDecipheriv` against the actual
`~/Library/Application Support/table-view/.key` decrypts both fixture
passwords back to `testpass`.

This invalidates the master handoff's "plaintext password" wording —
disk format is always ciphertext; only the *fixture spec input* is
plaintext.

## Top three follow-ups for next sprint

1. **Edge integrity — very_long truncation** (`generator.ts:190`). Drop the `maxLength >= EDGE_LONG.length` exclusion so the existing truncation branch (lines 206-212) actually fires. Otherwise 1 of 6 declared edge categories is silently unreachable for any production-shaped column.

2. **Mongo embed pre-bucketing** (`mongo.ts:137`). Replace per-parent `childRows.filter` with a one-shot `Map<parentId, ChildRow[]>` index. Expected to bring development mongo seed from 8.4s to ~2s.

3. **Test coverage** (`connections.ts`, `mongo.ts:shapeDocument`, `locale_mix` negative path). The novel mechanics (`Fixtures` group lifecycle, kind:many vs kind:one shaping) are currently unguarded.
