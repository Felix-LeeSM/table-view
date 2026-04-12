# Sprint Contract: Sprint 20

## Summary

- Goal: Schema Tree에 우클릭 컨텍스트 메뉴 추가 — 테이블 Drop/Rename, 스키마 Refresh, Structure/Data 탭 열기
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `mixed` (command)

## In Scope

- 테이블 노드 우클릭 → 컨텍스트 메뉴: "Structure", "Data", "Drop Table", "Rename Table"
- 스키마 노드 우클릭 → 컨텍스트 메뉴: "Refresh"
- "Structure" → Structure 서브뷰 활성화된 탭 열기
- "Data" → Records 서브뷰 활성화된 탭 열기
- "Drop Table" → 확인 다이얼로그 → DROP TABLE 실행
- "Rename Table" → 이름 입력 다이얼로그 → ALTER TABLE RENAME 실행
- Rust 백엔드: `drop_table`, `rename_table` Tauri commands 추가

## Out of Scope

- Table search/filter (Sprint 21)
- Column/index/constraint editing (Sprint 22+)
- 스키마 Drop/Create Table (이후 스프린트)
- 연결 노드 컨텍스트 메뉴 (이미 다른 곳에서 구현됨)

## Invariants

- 396 기존 테스트 통과
- 기존 SchemaTree 동작 유지 (카테고리, 아이콘, 하이라이트)
- 다크/라이트 테마 지원
- pnpm lint, pnpm tsc --noEmit 통과
- cargo fmt, cargo clippy 통과

## Acceptance Criteria

- `AC-01`: 테이블 노드 우클릭 시 컨텍스트 메뉴가 "Structure", "Data", "Drop Table", "Rename Table" 항목과 함께 표시됨
- `AC-02`: 스키마 노드 우클릭 시 "Refresh" 메뉴가 표시되고 클릭 시 스키마 새로고침 실행
- `AC-03`: "Structure" 클릭 시 Structure 서브뷰가 활성화된 탭이 열림
- `AC-04`: "Data" 클릭 시 Records 서브뷰가 활성화된 탭이 열림
- `AC-05`: "Drop Table" 클릭 시 확인 다이얼로그 표시 후 확인 시 DROP TABLE SQL 실행
- `AC-06`: "Rename Table" 클릭 시 이름 입력 다이얼로그 표시 후 ALTER TABLE RENAME 실행

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — 린트 에러 0
4. `cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings` — Rust 품질

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
