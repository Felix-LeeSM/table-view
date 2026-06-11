---
title: Rust 컨벤션
type: convention
updated: 2026-06-12
surface: src-tauri/**/*.rs
task: rust-impl, refactor
trigger:
  signal: src-tauri/**/*.rs 편집 시
  layer: hook (.claude/rules/rust-conventions.md paths frontmatter)
---

# Rust 컨벤션

`.claude/rules/rust-conventions.md` wrapper 가 가리키는 source. 모든 brain 공통.

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
  처럼 위험한 surface 는 기존 high-coverage 선례를 참고하되, 전역 frontend gate
  70/70/70 과 혼동하지 않는다.

## 보안

- 사용자 입력 항상 검증
- SQL injection 방지: 파라미터화된 쿼리
- 민감 정보 (비밀번호 등) 로그 출력 금지
- 안전한 직렬화/역직렬화

## 관련

- [conventions](../memory.md) — 상위 컨벤션 룸
- [refactoring](../refactoring/memory.md) — refactor 4 카테고리
- [testing-scenarios](../testing-scenarios/memory.md) — 시나리오 설계 8원칙
