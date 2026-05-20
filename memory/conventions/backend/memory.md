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

## Philosophy — Contract-first backend

Backend 는 DB truth, storage truth, secret, durable side effect 를 책임진다.
Frontend 는 operator flow 를 소유하지만, backend contract 밖에서 DB 상태를
추측하거나 영속 truth 를 우회하면 안 된다. Rust layer 는 Tauri command /
state / adapter / storage 경계를 명확히 유지해 frontend 가 믿을 수 있는
작은 contract 를 제공한다.

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
- command layer 는 thin orchestration 이다: input validate → `AppState`
  active connection resolve → paradigm gate (`ActiveAdapter::as_rdb()?` /
  `as_document()?`) → adapter 호출 → `AppError` 반환.
- RDB command 는 workspace caller 가 넘긴 `expected_database` 를 가능한 한
  `ensure_expected_db` 로 검증한다. mismatch 는 `AppError::DbMismatch` 로
  typed surface 한다.
- DDL/destructive command 는 request-shaped struct + `preview_only` 를
  우선하고, preview 와 execute 가 같은 SQL builder 를 공유하게 한다.
  execute branch 는 가능한 한 transaction 으로 감싼다.
- Public Tauri/store-facing wire structs default to
  `#[serde(rename_all = "camelCase")]`. Legacy restore/import compatibility is
  explicit via `#[serde(alias = "...")]`, `#[serde(default)]`, or a documented
  normalizer, not by leaking mixed casing into new payloads.
- Keep intentional snake_case exceptions only where the current contract says
  so, for example SQL/schema table-data fields and `BulkWriteResult` counters.
- error 는 `AppError` 계열로 context 를 보존한다. 문자열만 맞추는 테스트 금지.
- secret / connection string / password 는 log, debug output, fixture direct write 에 남기지 않음.
- async path 에 blocking 작업을 섞지 않는다. 필요 시 `spawn_blocking` 로 격리.
- command 가 cancel token 을 등록했다면 early return path 에서도 release 를
  보장한다. native cancel / cooperative cancel 의미를 섞지 않는다.
- wire struct 를 확장할 때는 `#[serde(rename_all = "camelCase")]` 와
  compatible default (`#[serde(default)]`) 를 우선 검토한다.

## Workflow

- Rust 변경은 `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`,
  관련 unit/integration test 를 통과시킨다.
- DB adapter 변경은 happy path, 빈 결과, driver error, unsupported feature 를 최소 세트로 검증.
- Tauri command 변경은 TS invoke 호출부와 serialization shape 를 같이 확인.

## 관련

- [rust](../rust/memory.md)
- [testing-scenarios](../testing-scenarios/memory.md)
- [architecture](../../architecture/memory.md)
