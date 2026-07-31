---
title: Rust 컨벤션
type: convention
updated: 2026-08-01
surface: src-tauri/**/*.rs
task: rust-impl, refactor
keywords: cargo fmt, cargo clippy, thiserror, unwrap(), spawn_blocking, tokio::sync::Mutex, cargo-mutants, --in-place, include_str!, sqlparser, raw_where.rs, SECURITY RE-AUDIT ON sqlparser BUMP
trigger:
  signal: src-tauri/**/*.rs 편집 시
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# Rust 컨벤션

모든 brain 공통 source. 자동 배달은 없으므로 직접 열어야 한다.

## 포맷팅 / 린트

- `cargo fmt` 통과 필수
- `cargo clippy --all-targets --all-features -- -D warnings` 통과 필수
- 들여쓰기: 4 spaces

## 에러 처리

- `thiserror` crate 로 커스텀 에러 타입 정의
- 함수 시그니처: `Result<T, AppError>` 반환
- `unwrap()` 금지 (테스트 코드 제외)
- 대안: `?`, `ok_or()`, `map_err()`
- 에러 전파 시 컨텍스트 보존: `.context()` 또는 `.map_err()`

```rust
// Good
fn get_user(id: u64) -> Result<User, AppError> {
    db::find_user(id).map_err(|e| AppError::Database(e.to_string()))
}
```

## Module 구조

- 파일 1개 = 주요 struct/trait 1개
- `mod.rs` 에서 공개 인터페이스 노출
- 비공개 헬퍼는 하단 배치
- 순환 의존성 금지

## 명명 규칙

- Types/Structs/Enums: PascalCase (`ConnectionConfig`)
- Functions/Methods: snake_case (`get_tables`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_CONNECTIONS`)
- Modules: snake_case (`db_adapter`)

## 비동기

- 모든 DB I/O 는 `async fn`
- `tokio` 런타임
- 블로킹 작업 → `spawn_blocking` 격리
- async 함수에서 `std::sync::Mutex` 대신 `tokio::sync::Mutex`

## 테스트

- 단위: 같은 파일 하단 `#[cfg(test)] mod tests {}`
- 통합: `src-tauri/tests/`
- 명명: `test_<동작>_<조건>_<기대결과>`
- 모든 공개 함수에 테스트 필수
- 커버리지: Rust local target 은 sprint/contract 에 명시한다. Parser/adapter/command
  처럼 위험한 surface 는 기존 high-coverage 선례를 참고한다. Frontend/Rust shared
  coverage floor 는 `.github/workflows/ci.yml` 의 `--fail-under-*` 리터럴이 소유한다.
- cargo-mutants 는 `--in-place` 로 돌린다 — crate 밖 `include_str!` 때문에 기본 copy
  모드는 전량 실패한다. `safety.rs` mutation score baseline 은 63.5% (2026-07-28).

## 보안

- 사용자 입력 항상 검증
- SQL injection 방지: 파라미터화된 쿼리
- 민감 정보 (비밀번호 등) 로그 출력 금지
- 안전한 직렬화/역직렬화
- **`sqlparser` 범프 시 `db/raw_where.rs` 재감사 필수** (#1620 F1). `is_safe_value_expr`
  / `is_predicate` 의 allowlist 는 `Expr` variant + child field 를 열거하는데,
  `..` rest 패턴과 `_ => false` 때문에 범프로 기존 variant 에 새 subquery-bearing
  field 가 추가되면 검사 없이 조용히 흡수됨 (#1549 류 우회 재발). Cargo.lock
  `sqlparser` 버전 변경 PR 은 `Expr` diff 후 매칭된 variant 의 미검증 child 부재를
  재확인. 코드 주석(SECURITY RE-AUDIT ON sqlparser BUMP)이 대응 지점.

## 관련

- [conventions](../memory.md) — 상위 컨벤션 룸
- [refactoring](../refactoring/memory.md) — refactor 4 카테고리
- [testing-scenarios](../testing-scenarios/memory.md) — 시나리오 설계 9원칙
