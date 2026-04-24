# Sprint 63 Execution Brief — Phase 6 Trait Layer (plan A1)

## Objective
Phase 6 MongoDB 지원을 위한 **trait 계층 기반 설계**를 behavior change 0으로 도입한다. 기존 `PostgresAdapter`를 새 `RdbAdapter` trait의 구현체로 연결하되, 구체 메서드는 그대로 두고 trait 메서드는 얇은 위임만 한다.

## Task Why
Phase 6(Mongo)/7(ES)/8(Redis)는 모두 paradigm이 다르다. 현재 `AppState`가 `PostgresAdapter`로 타입 고정되어 있어 다른 DB를 추가하려면 먼저 polymorphism을 도입해야 한다. 플랜 A1(=Sprint 63)은 그 기반의 **설계 부분만** 처리해 Sprint 64/A2(AppState/command 리팩터) 시 diff를 최소화한다.

## Scope Boundary
- 변경 파일은 `src-tauri/src/db/mod.rs`와 `src-tauri/src/db/postgres.rs` 두 개에 한정 (필요 시 `models/` 참조하되 수정 없이 use만).
- AppState/command/frontend/tests는 절대 건드리지 않는다.
- 기존 `PostgresAdapter`의 concrete inherent 메서드는 수정/삭제 금지 (이름, 인자 순서, 가시성 유지).

## Invariants
- 기존 Tauri command 동작 불변 (invoke 이름/payload 불변).
- 통합 테스트 회귀 0.
- `cargo clippy -D warnings` 유지.

## Done Criteria
마스터 contract의 Done Criteria 1~5를 모두 만족.
핵심 요약:
1. `db/mod.rs`에 `DbAdapter`(기존 + `kind()`), `RdbAdapter`, `DocumentAdapter`, `SearchAdapter`, `KvAdapter`, DTO(`NamespaceLabel/NamespaceInfo/FindBody/DocumentQueryResult/DocumentId/RdbQueryResult`), `ActiveAdapter` enum + accessor 모두 선언.
2. `postgres.rs`에 `impl RdbAdapter for PostgresAdapter` 위임 블록 추가.
3. 모든 검증 command 통과.

## Verification Plan
- Profile: `command`
- Required checks:
  1. `cd src-tauri && cargo fmt --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test --lib`
  4. `pnpm tsc --noEmit`
  5. `pnpm lint`
  6. `pnpm vitest run`

## Evidence To Return
- 변경 파일 목록(경로 + 한 줄 목적)
- 각 verification command의 성공 여부 (실패 시 마지막 출력 일부)
- Done Criteria 각 항목 대응 근거 (파일:라인 인용)
- `DbAdapter::kind()` 추가가 기존 impl에 미친 영향 및 대응
- 발견한 가정/위험/미해결 지점

## 구현 힌트 (참고용, 강제 아님)
- `DbAdapter`에 `kind()` 추가가 파급 생길 수 있음 → `PostgresAdapter`에 `DatabaseType::Postgresql` 리턴 구현 하나만 추가.
- `BoxFuture<'_, Result<T, AppError>>` 시그니처는 이미 기존 trait이 사용하는 방식에 맞춘다. dyn-safe 유지.
- `ActiveAdapter::as_rdb()` 등의 `Result`는 `Err(AppError::Unsupported(...))` 형태로 반환. `AppError`에 `Unsupported` variant가 없으면 Sprint 64/A2에서 추가하도록 남기고, 이번 sprint(63/A1)에서는 기존 `AppError` 변형(예: `Internal`/`InvalidInput`) 중 하나로 일단 연결 — **선택 이유를 evidence에 기록**.
- `DocumentAdapter`/`SearchAdapter`/`KvAdapter` 시그니처는 이번 sprint에서 컴파일되기만 하면 OK. `DocumentAdapter`는 계획서의 signature를 그대로 사용, Search/Kv는 빈 trait body.
- `list_views`/`list_functions`의 default 빈 구현은 `Box::pin(async { Ok(vec![]) })` 패턴.
- `mod.rs`는 기존 public re-export(`pub use postgres::PostgresAdapter`)를 유지.
