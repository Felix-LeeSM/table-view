# Sprint Contract: Sprint 19

## Summary

- Goal: Schema Tree 시각적 개선 — 카테고리 분류, 계층별 아이콘, 선택 하이라이트, 섹션 구분자
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `mixed` (command for tests + static for component verification)

## In Scope

- Schema 노드 확장 시 Tables, Views, Functions, Procedures 카테고리 표시 (Phase 2 / F2.1)
- 현재 선택된 노드 하이라이트 배경색 (Phase 2 / F2.1)
- 연결/스키마/테이블 계층별 시각적 구분 (폰트, 들여쓰기, 배경) (Phase 2 / F2.1)
- 계층별 다른 아이콘 스타일 (Phase 2 / F2.1)
- 스키마 섹션 구분자/헤더 (Phase 2 / F2.1)

## Out of Scope

- Context menu (Sprint 20)
- Table search/filter (Sprint 21)
- Views/Functions 데이터 로딩 (현재는 카테고리 헤더만 표시, 내용은 빈 상태)
- Column/index/constraint 편집 (Sprint 22+)
- 프로덕션 코드 외 파일 변경

## Invariants

- 기존 376 frontend 테스트 통과
- 기존 SchemaTree 동작 (스키마 로딩, 테이블 목록, 테이블 클릭으로 탭 열기) 유지
- 다크/라이트 테마 모두 정상 동작
- pnpm lint, pnpm tsc --noEmit 통과

## Acceptance Criteria

- `AC-01`: 스키마 노드 확산 시 "Tables", "Views", "Functions", "Procedures" 카테고리가 접을 수 있는 섹션으로 표시됨 (Tables 아래에 기존 테이블 목록, 나머지는 빈 상태)
- `AC-02`: 현재 선택된 노드(연결/스키마/테이블)가 배경색으로 하이라이트됨
- `AC-03`: 연결 노드, 스키마 노드, 카테고리 헤더, 테이블 노드 각각이 시각적으로 구분됨 (다른 폰트 굵기, 들여쓰기 레벨)
- `AC-04`: 각 계층에 다른 아이콘 적용: 연결=Database, 스키마=FolderOpen, 카테고리=Grid3/Code2/Eye, 테이블=Table2
- `AC-05`: 스키마 섹션 사이에 구분선 또는 헤더 라벨 표시

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과 (기존 + 신규)
2. `pnpm tsc --noEmit` — 타입 체크 통과
3. `pnpm lint` — 린트 에러 0
4. SchemaTree 컴포넌트 테스트에 카테고리 렌더링, 하이라이트, 아이콘 관련 테스트 포함

### Required Evidence

- Generator must provide:
  - 변경된 파일 목록과 목적
  - 테스트 실행 결과
  - 각 AC에 대한 구현 증거
- Evaluator must cite:
  - 코드 검증 결과
  - 누락된 테스트 케이스

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in handoff.md
