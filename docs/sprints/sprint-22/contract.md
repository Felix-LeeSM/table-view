# Sprint Contract: Sprint 22

## Summary

- Goal: Rust 백엔드에 ALTER TABLE, CREATE/DROP INDEX, ADD/DROP CONSTRAINT Tauri commands 추가
- Owner: Orchestrator
- Verification Profile: `mixed` (command — cargo test + pnpm vitest)

## In Scope

- `alter_table` Tauri command: 컬럼 add/modify/delete
- `create_index` / `drop_index` Tauri commands
- `add_constraint` / `drop_constraint` Tauri commands
- `preview_only` 플래그로 SQL 미리보기만 반환
- TypeScript 타입 정의
- IPC 래퍼 함수
- 단위 테스트

## Out of Scope

- UI (StructurePanel 편집은 Sprint 23)
- 통합 테스트 (Docker DB 필요, CI에서 처리)

## Invariants

- 424 기존 프론트엔드 테스트 통과
- cargo fmt, cargo clippy 통과
- 기존 Rust 테스트 통과
- SQL injection 방지 (파라미터화된 쿼리)

## Acceptance Criteria

- `AC-01`: `alter_table` command가 컬럼 추가(MAKE), 수정(ALTER), 삭제(DROP) SQL을 생성하고 실행
- `AC-02`: `create_index` command가 인덱스 생성 SQL을 실행
- `AC-03`: `drop_index` command가 인덱스 삭제 SQL을 실행
- `AC-04`: `add_constraint` / `drop_constraint` commands가 제약조건 관리 SQL을 실행
- `AC-05`: 모든 command에 `preview_only: true` 시 SQL만 반환하고 실행하지 않음
- `AC-06`: TypeScript 타입과 IPC 래퍼가 존재하고 기존 패턴을 따름

## Verification Plan

1. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — Rust 단위 테스트
2. `cargo clippy` — 린트
3. `pnpm vitest run` — 프론트엔드 테스트
4. `pnpm tsc --noEmit` — 타입 체크
