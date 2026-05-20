---
title: Backend guidance
type: convention
updated: 2026-05-20
surface: src-tauri/**/*.rs
task: backend, rust-impl, tauri
trigger:
  signal: src-tauri backend 편집 시
  layer: agent-prompt
---

# Backend Guidance

Backend 변경은 Tauri command / state / DB adapter contract 를 깨지 않는 것이
우선이다. 편의상 빠른 happy path 를 추가하지 말고 에러/동시성/취소 경로를 같이 본다.

## Source Order

1. 기존 module boundary 와 public command signature
2. [rust](../rust/memory.md)
3. [testing-scenarios](../testing-scenarios/memory.md)
4. 본 문서

## 원칙

- command signature 변경은 user-facing contract 변경으로 보고 호출부와 테스트를 함께 갱신.
- DB I/O 는 adapter trait 경계를 지킨다. DBMS 별 예외는 adapter 내부에 가둔다.
- error 는 `AppError` 계열로 context 를 보존한다. 문자열만 맞추는 테스트 금지.
- secret / connection string / password 는 log, debug output, fixture direct write 에 남기지 않음.
- async path 에 blocking 작업을 섞지 않는다. 필요 시 `spawn_blocking` 로 격리.

## Workflow

- Rust 변경은 `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`,
  관련 unit/integration test 를 통과시킨다.
- DB adapter 변경은 happy path, 빈 결과, driver error, unsupported feature 를 최소 세트로 검증.
- Tauri command 변경은 TS invoke 호출부와 serialization shape 를 같이 확인.

## 관련

- [rust](../rust/memory.md)
- [testing-scenarios](../testing-scenarios/memory.md)
- [architecture](../../architecture/memory.md)
