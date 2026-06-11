---
title: Fixture strategy — support claims need local evidence
type: convention
updated: 2026-06-12
task: test-writing, fixture, data-source-promotion, support-claim
surface: src-tauri/src/db/fixtures.rs, src-tauri/tests, tests/fixtures, e2e/fixtures
trigger:
  signal: fixture 추가 / DBMS support claim / adapter conformance test
  layer: index
---

# Fixture strategy — support claims need local evidence

Fixture 는 제품 기능 자체가 아니라 **지원 범위 주장의 증거**다. 새 DBMS,
adapter, parser, result envelope, safety policy 를 "지원한다"고 말하려면 local
fixture 또는 emulator/testcontainer/embedded sample 로 재현 가능한 증거가 있어야
한다. fixture 만 있는 기능은 active runtime 이 아니라 `fixture-backed` 또는
`fixture-only` 로 명시한다.

## Canonical roots and test placement

- `e2e/fixtures/<dbms>/<function>/...` — DBMS-first runtime/smoke seed topology.
  현재 function 은 `query`, `document`, `kv`, `search` 가 active 이고,
  `completion`, `catalog`, `explain`, `errors`, `edit`, `safety`, `metadata` 는
  증거가 생길 때 같은 DBMS-first 규칙으로 추가한다.
- `e2e/fixtures/seed-smoke.ts` — external service seed orchestrator. SQLite/DuckDB
  file smoke 는 spec 이 local SQL seed 를 직접 읽는다.
- `e2e/fixtures/smoke-routing-decisions.json` — fixture promotion tier 와
  smoke-routing decision 의 machine-readable SOT.
- `tests/fixtures/**` — shared TS/Rust/parser/support-boundary contract fixtures.
  제품 runtime support claim 으로 승격하지 않는다.
- `src-tauri/src/db/fixtures.rs` — backend adapter fixture harness. 현재 Search
  embedded fixtures 만 등록한다; missing RDBMS fixture diagnostic 은 의도된 guard 다.
- `fixtures/**` — fixture generator/profile spec. Runtime support evidence 가 아니다.
- Frontend unit/component tests stay near their domain under `src/**`; Rust
  integration tests stay under `src-tauri/tests`; E2E smoke stays under `e2e/smoke`;
  fixture tooling tests stay under `scripts/fixtures`.

## 기본 원칙

1. **Local-first** — paid cloud service 는 유일한 검증 경로가 될 수 없다.
   local container, embedded sample, testcontainer, emulator, bounded mock 중 하나가
   있어야 한다.
2. **Selector-based** — adapter-level fixture 는 가능하면
   `table_view_lib::db::fixtures` 로 요청한다. selector 는 profile, dialect
   family, paradigm 중 하나를 사용하고 필요한 capability label 을 요구한다.
3. **Missing fixture = diagnostic failure** — fixture 가 없으면 skip 하거나
   fallback 성공으로 처리하지 않는다. 요청 selector 와 사용 가능한 fixture 후보를
   에러에 포함한다.
4. **Capability를 좁게 적는다** — catalog/query/result/edit/safety/lifecycle 중
   실제 fixture 가 증명한 것만 지원 claim 에 연결한다.
5. **Mock은 contract 전용** — mock DB 는 boundary contract 를 검증할 때만 사용한다.
   live runtime 지원의 대체 증거로 쓰지 않는다. 이 룰은
   [mock-scope](../mock-scope/memory.md) 의 P6와 같이 적용한다.

## Fixture 정의에 포함할 것

- 대상: `DatabaseType`, dialect family, paradigm, 또는 shared fixture 이름.
- lifecycle: embedded static, temp file, docker/testcontainer, emulator, seeded DB.
- seed/reset/cleanup: deterministic seed, idempotent reset, cleanup 책임.
- privacy: network access 여부, local-first 여부, secret persistence 여부.
- capabilities: fixture 가 증명하는 contract label.
- conformance: connection/catalog/query/result/edit/safety 중 어느 레벨을 덮는지.

## 작성 규칙

- seed 는 테스트 순서와 무관해야 한다. leftover 가능성이 있으면 먼저 drop/reset 후
  seed 한다.
- shared data fixture 는 `schema_version` 또는 동등한 version marker 를 둔다.
  Rust/TS 양쪽에서 같은 데이터를 읽는 경우 한 파일을 로드하고 별도 복사본을 만들지
  않는다.
- SQL emitter 나 serializer fixture 는 byte-equivalent assertion 으로 고정한다.
  기대 문자열을 바꾸려면 product/architecture 의미 변화와 migration 근거가 있어야
  한다.
- `fixture-backed` 기능을 product/docs 에 적을 때는 live connection, auth/TLS,
  admin, observability 등 미구현 surface 를 같이 적는다.

## Promotion gate

새 data source 또는 fixture-backed slice 를 active support 로 승격하려면 sprint
contract/handoff 에 다음을 남긴다.

- profile/support level
- fixture selector 와 local-first 증거
- capability/conformance coverage
- 실행한 fixture test command
- consuming contract/integration/E2E test path
- product support claim 또는 known limitation 업데이트 여부
- smoke routing tier: `unit-only`, `integration-backed`, `dormant E2E`, or
  `blocking E2E`
- unsupported/deferred surface

## Smoke routing policy

Fixture existence alone never widens product support. Routine Runtime Happy Path
evidence requires all of these:

- fixture path exists in the canonical topology
- a consumer test/spec reads it
- `e2e/fixtures/smoke-routing-decisions.json` records the tier and cost/risk
- `.github/workflows/e2e-smoke.yml` and `scripts/e2e-smoke-ci.sh` wire the spec
  when the tier is `blocking E2E`

Unsupported/partial-support fixtures are negative evidence. They protect support
boundaries and must not be cited as runtime support.

## 관련

- [testing-scenarios](../memory.md) — 비-E2E 테스트 시나리오 원칙
- [mock-scope](../mock-scope/memory.md) — mock 은 boundary 에만
- [adding-a-data-source](../../../architecture/data-source/adding/memory.md) — 새 source checklist
- [data-source-architecture](../../../architecture/data-source/memory.md) — fixture harness / support claim architecture
