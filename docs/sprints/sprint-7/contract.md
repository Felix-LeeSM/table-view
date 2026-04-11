# Sprint Contract: sprint-7

## Summary

- Goal: SchemaTree 컴포넌트 테스트 추가 (0% → 70%+)
- Audience: Generator, Evaluator
- Owner: Claude Code
- Verification Profile: `command`

## In Scope

- SchemaTree.tsx 스키마 트리 렌더링, 확장/축소, 테이블 클릭 테스트
- 전체 커버리지 52% → 55%+ 상승 확인

## Out of Scope

- Sidebar 컴포넌트 테스트
- schemaStore 자체 테스트 (이미 존재)
- 커버리지 임계값 상향

## Invariants

- 기존 184개 테스트 모두 통과
- 프로덕션 코드 변경 없음 (테스트만 추가)

## Acceptance Criteria

- `AC-01`: SchemaTree가 마운트 시 schemaStore.loadSchemas(connectionId) 호출
- `AC-02`: 스키마 목록이 렌더링됨 (스키마 이름 표시)
- `AC-03`: 스키마 클릭 시 확장/축소 토글 (ChevronDown ↔ ChevronRight)
- `AC-04`: 스키마 확장 시 loadTables 호출 후 테이블 목록 렌더링
- `AC-05`: 테이블 클릭 시 addTab으로 table 탭 생성
- `AC-06`: "New Query" 버튼 클릭 시 addQueryTab 호출
- `AC-07`: "Refresh" 버튼 클릭 시 스키마 재로드
- `AC-08`: 테이블이 없는 스키마에서 "No tables" 메시지 표시
- `AC-09`: row_count가 있는 테이블에 행 수 표시
- `AC-10`: refresh-schema 커스텀 이벤트 수신 시 스키마 재로드
- `AC-11`: SchemaTree.tsx 라인 커버리지 70%+

## Design Bar / Quality Bar

- store 모킹: schemaStore, tabStore 모킹으로 유닛 테스트 격리
- Tauri IPC: schemaStore 내부에서 이미 처리되므로 직접 모킹 불필요
- 렌더링 테스트: 스키마/테이블 아이콘, 텍스트, 로딩 상태 확인

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm vitest run --coverage` — SchemaTree 70%+, 전체 55%+
3. `pnpm tsc --noEmit` — 타입 체크 통과

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
- Evaluator must cite:
  - concrete evidence for each pass/fail decision
  - any missing or weak evidence as a finding

## Test Requirements

### Unit Tests (필수)
- AC-01~AC-11 각각 대응 테스트
- 에러 케이스: loadSchemas 실패 시 동작

### Coverage Target
- SchemaTree.tsx: 70%+

### Scenario Tests (필수)
- [ ] Happy path: 마운트 → 스키마 로드 → 확장 → 테이블 클릭
- [ ] 에러/예외: loadSchemas/loadTables 실패
- [ ] 경계 조건: 빈 스키마, row_count null, connectionId 변경
- [ ] 기존 기능 회귀 없음

## Test Script / Repro Script

1. `pnpm vitest run src/components/SchemaTree.test.tsx`
2. `pnpm vitest run`
3. `pnpm vitest run --coverage`

## Ownership

- Generator: general-purpose
- Write scope: `src/components/SchemaTree.test.tsx`
- Merge order: 단일 커밋

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
