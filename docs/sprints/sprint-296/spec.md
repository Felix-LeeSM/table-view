# Feature Spec: MySQL testcontainers 통합 합류 + coverage gate 일원화

## Description

push 실패의 root cause 는 두 가지가 한 사슬로 묶여 있음:

1. **MySQL adapter 가 통합 coverage gate 에 미합류** — `db/mysql/queries.rs`
   (16.11%), `db/mysql/schema.rs` (13.91%), `db/mysql.rs` (24.73%) 가 unit-mock
   path 만 cover. `tests/common/mod.rs:271` 의 *"Sprint 253 will swap the body
   to lazy-spawn a testcontainers MySQL"* 빚이 누적되어 sprint-281/288 cushion
   후퇴로 가려져 있었음.
2. **pre-commit / pre-push 임계 비대칭** — pre-commit Tier 1 (70/69/71, unit
   only) 은 통과하지만 pre-push Tier 1+2 (83/76/81, unit+통합) 가 baseline
   drift (77.77/72.96/77.39) 로 미달. **"commit OK + push fail"** 의 비대칭이
   silent drift 를 정당화함.

본 sprint 는 둘을 같이 해결한다 — MySQL 을 통합 게이트에 합류시키고, 두 hook
의 측정/임계를 **동일한 호출로 일원화**한다. push 막힌 sprint-292/293/294/295
commit 이 이 sprint 의 commit 과 함께 push 되며 unblock.

## Sprint Breakdown

Sprint 단위는 sprint-296 한 개. 내부적으로 **3 슬라이스** — Foundation → Core
→ Wire. (sprint-294/295 와 다른 모양 — 본 sprint 는 frontend 가 아니라 backend
test infra + hook 정책이라 Edge/Regression 이 자연스럽지 않다. 회귀는
Slice C 의 baseline 측정 + ADR 로 흡수.)

### Slice A — Foundation: testcontainers MySQL spawn helper

**Goal**: `tests/common/mod.rs::mysql_endpoint()` 를 PG/Mongo 패턴 그대로
mirror — env-var override 우선, 없으면 testcontainers lazy spawn.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. `Cargo.toml` 의 `[dev-dependencies] testcontainers-modules` features 에
   `mysql` 추가 — `grep -q "testcontainers-modules.*mysql" src-tauri/Cargo.toml` exit 0.
2. `tests/common/mod.rs` 상단 `use` 블록에 `testcontainers_modules::mysql::Mysql as MysqlImage`
   import 추가.
3. `mysql_endpoint()` body 가 두 단계:
   - (1) `MYSQL_HOST` + `MYSQL_PORT` (+ optional `MYSQL_USER`/`MYSQL_PASSWORD`/`MYSQL_DATABASE`)
     모두 있으면 외부 인스턴스 재사용.
   - (2) 없으면 `MYSQL_CONTAINER.get_or_init(...)` 로 testcontainers lazy spawn —
     owner-pid 라벨 + `ensure_sweep_once()` 호출 (PG/Mongo 와 정확히 같은
     좀비 청소 패턴).
4. spawn 실패 시 `println!("SKIP: MySQL testcontainer 시작 실패 ({}). Docker
   daemon 이 떠 있는지 확인하거나 MYSQL_HOST/MYSQL_PORT/MYSQL_USER/MYSQL_PASSWORD
   환경 변수로 외부 인스턴스를 지정하세요.", e)` — PG/Mongo 와 같은 문구 모양.
5. `#[allow(dead_code)]` 어트리뷰트 제거 — Slice B 가 실제로 호출.
6. 신규 `MYSQL_CONTAINER: OnceLock<...>` 정적 변수 PG/Mongo 와 같은 모양으로
   선언.
7. `cargo build --tests` exit 0. `cargo test --test mysql_integration -- --list` 가 빈 리스트라도 컴파일 성공.

**Components**:
- `src-tauri/tests/common/mod.rs`: `mysql_endpoint` body swap + `MYSQL_CONTAINER` 추가.
- `src-tauri/Cargo.toml`: `testcontainers-modules` features 에 `mysql` 추가.
- `src-tauri/.cargo/config.toml`: alias `mysql-test = "test --test mysql_integration"`
  추가. 기존 `db-test` alias 에도 `--test mysql_integration` 합산.

### Slice B — Core: mysql_integration.rs 시나리오 mirror + dialect

**Goal**: PG 의 `query_integration` + `schema_integration` 63 시나리오를
MySQL 로 1:1 mirror (X+ 정책) — dialect 만 패치. 추가로 PG/MySQL 양쪽에 가치
있는 시나리오는 양쪽에 추가, MySQL-only dialect 시나리오는 별도 module.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. 신규 파일 `src-tauri/tests/mysql_integration.rs` 가 존재하며 헤더에
   `Sprint 296 (2026-05-14) — MySQL adapter 통합 게이트 합류` + 작성 이유 명시.
2. `tests/query_integration.rs` 의 31 시나리오 (SELECT, INSERT, UPDATE,
   DELETE, transaction, RETURNING/equivalent, pagination, prepared statement,
   error path 등) 가 MySQL adapter 로 mirror — 시나리오 명명 규칙 그대로,
   adapter type 만 swap. PG-only feature (예: `RETURNING`) 는 MySQL equivalent
   (`LAST_INSERT_ID()`) 또는 명시적 `#[ignore = "MySQL: no RETURNING — sprint-NNN dialect note"]`.
3. `tests/schema_integration.rs` 의 32 시나리오 (CREATE/ALTER/DROP TABLE,
   INDEX, FK, schema introspection, column metadata 등) 가 MySQL 로 mirror.
4. MySQL-only dialect 시나리오 (별도 `mod dialect` 또는 별도 module file):
   - backtick 식별자 (`\`order\``, `\`select\``).
   - `AUTO_INCREMENT` PK + `LAST_INSERT_ID()` round-trip.
   - `ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` 옵션 보존.
   - `SHOW CREATE TABLE` introspection — `pg_catalog` 와 동등한 정보가
     adapter level 에서 정규화되는지.
   - `INSERT ... ON DUPLICATE KEY UPDATE` (PG 의 `ON CONFLICT` 대응).
   - `LIMIT N OFFSET M` (PG 와 거의 같지만 dialect 차이 단언).
   - MySQL implicit zero-date (`'0000-00-00'`) 처리 — adapter 가 NULL 로
     정규화 또는 raw 보존 정책 명시 + 테스트.
5. PG/MySQL 양쪽에 추가할 가치가 있다고 발견된 시나리오 — 양쪽 파일에
   대칭 추가 (X+ 정책의 "양쪽 추가" 부분). 한쪽에만 추가하면 sprint-296
   본 spec 위반.
6. `cargo mysql-test` exit 0 — 모든 시나리오 GREEN, dialect-only 시나리오
   포함.
7. PG/Mongo 회귀 없음 — `cargo pg-test` / `cargo mongo-test` exit 0.

**Components**:
- `src-tauri/tests/mysql_integration.rs`: 신규.
- `src-tauri/tests/query_integration.rs`: 양쪽 추가 시나리오 보강 (있다면).
- `src-tauri/tests/schema_integration.rs`: 양쪽 추가 시나리오 보강 (있다면).
- `src-tauri/tests/common/mod.rs`: MySQL fixture seeder (PG 의 `seed_*` 와
  대칭) 추가.

### Slice C — Wire: lefthook 일원화 + wrapper script + baseline + ADR

**Goal**: pre-commit / pre-push 두 게이트가 **동일한 `cargo llvm-cov` 호출 +
동일한 임계** 로 작동. DB 도달 수단 사전 검증 wrapper. 새 baseline 측정 후
2pp 균일 cushion 임계값 재설정. ADR 0021 신규.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. 신규 `scripts/check-db-reachable.sh` — daemon / env-var / host-native 세
   수단을 순차 검사, 어느 하나라도 reachable 이면 exit 0, 셋 다 없으면
   다중-옵션 안내 출력 + exit 1. Output 구조는 본 spec 의 "실패 메시지
   템플릿" 참고.
2. `lefthook.yml` 의 pre-commit `rust-coverage` 가:
   - 명령 본문이 `bash scripts/check-db-reachable.sh && cd src-tauri && cargo
     llvm-cov --lib --test storage_integration --test query_integration --test
     schema_integration --test fixture_loading --test mongo_integration --test
     mysql_integration --summary-only --fail-under-lines <new> --fail-under-functions
     <new> --fail-under-regions <new>`.
   - 임계값 `<new>` 는 Slice B 종료 후 5-trial median 측정값에서 균일 2pp
     하향.
3. `lefthook.yml` 의 pre-push `6_rust-coverage` 명령이 pre-commit 과 동일 —
   임계값 포함. 두 hook 의 명령 본문이 한 줄도 다르지 않아야 함 (DRY).
   가능하다면 `scripts/run-coverage-gate.sh` 로 추출.
4. pre-commit `rust-pg-test` / `rust-mongo-test` 의 staged-path conditional
   alias 는 **제거** — 통합 게이트가 모든 commit 에 도므로 conditional 이
   redundant.
5. `scripts/setup.sh` 가 `check-db-reachable.sh` 를 사전 호출, 환경 안내.
6. ADR 신규: `docs/archives/decisions/0021-coverage-gate-parity/memory.md` —
   - Context: D1 일원화, E1 No escape, F2 wrapper script.
   - Decision: pre-commit/pre-push coverage gate 명령 + 임계 일원화.
   - Consequences: docker daemon 또는 외부 DB 수단 가동이 모든 commit 의
     사전 조건. baseline drift 즉시 차단. push 실패 메시지가 commit 시점에
     선이동.
   - Trade-off: daemon 미가동 환경에서 commit 자체 불가 — 사외 PR contributor
     는 fork 에서 daemon 가동 또는 CI 에서 검증 (ADR 0019 와 정책 정합).
7. 새 baseline 측정 protocol: 5-trial median, container warm 상태에서.
   `docs/sprints/sprint-296/baseline.md` 에 5 trial 의 raw 측정 + median
   기록.
8. push 통과: `git push` 가 sprint-292/293/294/295/296 commit 합본을 거부
   없이 받음 (사용자가 직접 실행, 본 sprint 의 종료 신호).

**Components**:
- `scripts/check-db-reachable.sh`: 신규.
- `scripts/run-coverage-gate.sh`: 신규 (DRY 추출).
- `lefthook.yml`: pre-commit/pre-push 양쪽 본문 swap.
- `scripts/setup.sh`: check 호출 추가.
- `docs/archives/decisions/0021-coverage-gate-parity/memory.md`: 신규 ADR.
- `docs/sprints/sprint-296/baseline.md`: 5-trial 측정 기록.

## Global Acceptance Criteria

1. 신규 crate 의존성: `testcontainers-modules` 의 `mysql` feature 외 없음.
2. 모든 새 테스트 파일 헤더에 `Sprint 296 (2026-05-14)` + 작성 이유 코멘트
   (`.claude/rules/testing.md` + memory `feedback_test_documentation`).
3. PG/Mongo 회귀 0 — 기존 64 시나리오 (query 31 + schema 32 + mongo 11 -
   주의: 시나리오 count 는 sprint 진행 중 실측치로 갱신) 그대로 GREEN.
4. MySQL adapter 의 unit-mock 테스트 (`db/mysql/{queries,schema,mutations,
   connection}.rs::tests::*`) 회귀 0.
5. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
6. `cargo fmt --check` exit 0.
7. ignored unit 테스트 2 개 (`db::mongodb::connection::tests::test_switch_active_db_happy_path_with_live_mongo`,
   `db::postgres::connection::tests::test_switch_active_db_cache_miss_creates_lazy_pool`)
   는 **이번 sprint 에서 손대지 않음** — S2/S3 후속 sprint 가 통합 mirror
   여부 검증 후 삭제/이주 결정.
8. push 막힌 d4d9e7a (sprint-292) 가 sprint-296 작업 합본으로 unblock.

## 정책 결정 요약 (grill-me 산출물)

| 결정 | 값 | 근거 |
|---|---|---|
| 전략 | A 정공법 (MySQL 통합 합류) | baseline 정책 무손상 + 사용자 의도 일치 |
| Scope | S1 (sprint-296), 최종 S3 | 한 sprint 한 목적 |
| 시나리오 정책 | X+ (1:1 mirror + 양쪽 추가 + dialect) | parity 강제 + 회귀 가드 |
| Slice | P2 3-slice (Foundation/Core/Wire) | 각 slice 자체 verification 으로 닫힘 |
| Cushion | C1 2pp 균일 | sprint-281/288 drift 패턴 차단 |
| Hook 정책 | D1 게이트 일원화 | commit/push 비대칭 0 |
| Escape | E1 No escape | hook 회피 금지 정책 정합 |
| 메시지 | F2 Wrapper script | 4 호출지점 DRY + 다중-옵션 안내 |

## 실패 메시지 템플릿 (`scripts/check-db-reachable.sh` 출력)

```
ERROR: 통합 coverage gate 가 PG/Mongo/MySQL 인스턴스에 도달할 수 없습니다.

검사 결과:
  ✗ Docker daemon       (docker info: 응답 없음)
  ✗ env-var override    (TEST_PG / MONGO_HOST / MYSQL_HOST 미설정)
  ✗ host-native PG      (pg_isready: not found)
  ✗ host-native Mongo   (mongosh: not found)
  ✗ host-native MySQL   (mysqladmin: not found)

다음 중 한 가지를 활성화하세요:

  [1] Docker daemon  (권장 — testcontainers 가 자동 spawn)
      $ open -a Docker                    # macOS
      $ systemctl start docker            # Linux

  [2] docker-compose long-lived 인스턴스  (반복 commit 시 빠름)
      $ docker-compose -f scripts/db/docker-compose.yml up -d
      $ source scripts/db/env.sh

  [3] Host-native DB                       (daemon 미설치 환경용)
      $ brew services start postgresql@16 mongodb-community mysql
      $ source scripts/db/env-native.sh

상세: docs/setup.md, 'bash scripts/setup.sh'

이 게이트는 pre-commit / pre-push coverage 임계의 baseline 무결성을 보장합니다.
.claude/rules/git-policy.md 정책상 우회 (LEFTHOOK_EXCLUDE 등) 는 허용되지
않습니다.
```

## Edge Cases

- **MySQL testcontainer cold spawn 시간**: PG/Mongo 보다 길 가능성 — Slice A
  종료 시 cold/cached 시간 측정해 `baseline.md` 에 기록. 1 분 초과 시 image
  pinning 또는 prebuilt fixture 검토.
- **MySQL strict mode**: testcontainers 의 기본 MySQL image 가 strict mode
  on/off 어느 쪽인지 확인. adapter 가 가정하는 동작과 일치해야.
- **timezone**: PG 와 MySQL 의 default timezone 차이 (UTC vs system) — Slice
  B 의 timestamp 시나리오 mirror 시 명시적으로 설정.
- **`utf8` vs `utf8mb4`**: MySQL 5.x default 가 `utf8` (3-byte) 라 4-byte
  UTF-8 (이모지 등) 실패. testcontainers MySQL 8.x default 확인 후 명시.
- **5-trial median measurement**: container warm 상태에서만 (첫 trial 은
  cold 제외). docker daemon 재시작 후 1 차 warm-up trial → 본격 5 trial.
- **D1 일원화 후 commit 시간**: pre-commit 이 매번 testcontainers 합산 측정 →
  cached ~1-2 분. docker-compose long-lived 인스턴스 + env override 시 ~30 초.
  사용자 워크플로우 영향. `baseline.md` 에 측정 시간 기록.

## Verification Hints

- Slice A 종료: `cargo build --tests` exit 0 + `cargo test --test
  mysql_integration -- --list` 가 빈 리스트.
- Slice B 종료: `cargo mysql-test` exit 0 + `cargo pg-test` / `cargo
  mongo-test` exit 0.
- Slice C 종료:
  - `bash scripts/check-db-reachable.sh` exit 0 (daemon 또는 env override
    가동 시).
  - `bash scripts/check-db-reachable.sh` exit 1 + 다중-옵션 안내 (daemon
    내린 상태에서).
  - `lefthook run pre-commit` + `lefthook run pre-push` 둘 다 exit 0.
  - `diff <(grep -A 5 'rust-coverage:' lefthook.yml) <(grep -A 5
    '6_rust-coverage:' lefthook.yml)` — 본문 일치 (또는 둘 다
    `scripts/run-coverage-gate.sh` 호출).
- 측정 기록: `docs/sprints/sprint-296/baseline.md` 5-trial median + 임계값
  derivation.

## Notes for Generator

- PG/Mongo 의 `tests/common/mod.rs::pg_endpoint` / `mongo_endpoint` 구조를
  **줄단위 mirror**. 변형 최소화 — owner-pid 라벨, sweep, OnceLock 패턴 그대로.
- `testcontainers_modules::mysql::Mysql` image 의 default credential 확인 —
  PG (`postgres`/`postgres`) 와 다를 수 있음. `MysqlImage::default()` 의
  document 확인 후 endpoint 의 user/password 값 결정.
- Slice B 의 시나리오 mirror 는 mechanical. PG file 을 복사 → adapter
  type/struct/dialect 만 swap. 새 로직 작성 금지 — PG 시나리오와 동등성
  유지 (X+ 정책의 "1:1" 부분).
- Dialect-only 시나리오 (X+ 정책의 "dialect" 부분) 는 별도 `mod dialect`
  로 grouping — mirror 시나리오와 섞이지 않게.
- Slice C 의 임계값 산정: `cargo llvm-cov` 5 trial 의 lines/functions/regions
  median 에서 각 2pp 하향. 소수점 절삭 (`floor`).
- ADR 0021 본문은 작성 순간 동결 (memory palace 규칙). Decision/이유/
  Consequences 수정 금지. 프론트매터 `status` 만 갱신 가능.

## Critical Files

- `src-tauri/tests/common/mod.rs` (mysql_endpoint swap)
- `src-tauri/tests/mysql_integration.rs` (신규)
- `src-tauri/Cargo.toml`
- `src-tauri/.cargo/config.toml`
- `lefthook.yml`
- `scripts/check-db-reachable.sh` (신규)
- `scripts/run-coverage-gate.sh` (신규)
- `scripts/setup.sh`
- `docs/archives/decisions/0021-coverage-gate-parity/memory.md` (신규)
- `docs/sprints/sprint-296/baseline.md` (신규)
