---
paths:
  - "src-tauri/**/*.rs"
---

# Rust 코딩 컨벤션

## 포맷팅 & 린트
- `cargo fmt` 통과 필수
- `cargo clippy --all-targets --all-features -- -D warnings` 통과 필수
- 들여쓰기: 4 spaces

## 에러 처리
- `thiserror` crate로 커스텀 에러 타입 정의
- 함수 시그니처: `Result<T, AppError>` 반환
- `unwrap()` 사용 금지 (테스트 코드 제외)
- 대안: `?` 연산자, `ok_or()`, `map_err()` 사용
- 에러 전파 시 컨텍스트 보존: `.context()` 또는 `.map_err()`

```rust
// Good
fn get_user(id: u64) -> Result<User, AppError> {
    db::find_user(id).map_err(|e| AppError::Database(e.to_string()))
}

// Bad
fn get_user(id: u64) -> User {
    db::find_user(id).unwrap()
}
```

## Module 구조
- 파일 하나당 하나의 주요 struct/trait
- `mod.rs`에서 공개 인터페이스 노출
- 비공개 헬퍼는 하단에 배치
- 순환 의존성 금지

## 명명 규칙
- Types/Structs/Enums: PascalCase (`ConnectionConfig`)
- Functions/Methods: snake_case (`get_tables`)
- Constants: SCREAMING_SNAKE_CASE (`MAX_CONNECTIONS`)
- Modules: snake_case (`db_adapter`)

## 비동기
- 모든 DB I/O 작업은 `async fn`으로 구현
- `tokio` 런타임 사용
- 블로킹 작업은 `spawn_blocking`으로 격리
- async 함수에서 `std::sync::Mutex` 대신 `tokio::sync::Mutex` 사용

## 테스트
- 단위 테스트: 같은 파일 하단 `#[cfg(test)] mod tests {}`
- 통합 테스트: `src-tauri/tests/` 디렉토리
- 테스트 함수명: `test_<동작>_<조건>_<기대결과>`
- 모든 공개 함수에 테스트 필수

## 보안
- 사용자 입력은 항상 검증
- SQL injection 방지: 파라미터화된 쿼리 사용
- 민감 정보(비밀번호 등)는 로그에 출력 금지
- 안전한 직렬화/역직렬화 사용
