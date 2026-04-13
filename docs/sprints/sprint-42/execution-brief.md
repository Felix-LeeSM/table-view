# Sprint Execution Brief: sprint-42

## Objective

- SchemaTree 헤더의 UUID를 연결 이름으로 교체
- 테이블 검색(Filter tables...) 버그 수정

## Task Why

- 사용자가 사이드바에서 UUID를 보는 것은 혼란스러움
- 테이블 검색이 동작하지 않아 탐색 효율이 저하됨

## Scope Boundary

- SchemaTree.tsx만 주로 수정
- connectionStore에서 연결 이름 조회 방식 추가 (필요시)
- Sidebar.tsx는 최소 수정만 (props 전달 등)

## Invariants

- "New Query" 버튼 기능 유지
- 스키마 확장/축소 동작 유지
- 기존 테스트 모두 통과

## Done Criteria

1. SchemaTree 헤더에 연결 이름 표시, UUID 미표시
2. 테이블 검색이 정상적으로 필터링 동작
3. 검색 결과 없음 메시지 정상 표시
4. 필터 clear 버튼 정상 동작

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run` — 전체 테스트 통과
  2. `pnpm tsc --noEmit` — 타입 체크 통과
  3. `pnpm lint` — 린트 에러 0건
- Required evidence:
  - 변경된 파일 목록과 목적
  - 테스트 실행 결과
  - 각 AC에 대한 증거

## Evidence To Return

- Changed files with purpose
- Commands/checks run and outcomes
- Acceptance criteria coverage with evidence
- Assumptions, risks, unresolved gaps

## Key Context

**Bug: UUID in header**: `SchemaTree.tsx` line 384 renders `{connectionId}` directly. The `connectionId` prop is a UUID string. The component needs access to the connection name (e.g., "My PostgreSQL") instead.

**Bug: Table search not working**: The search input exists in SchemaTree (lines 561-597) with filtering logic (lines 503-517). The user reports it's not working. Need to investigate:
- Is the `tableSearch` state being set correctly?
- Is the filtering logic matching correctly?
- Is the search input rendering in the right place?
- Are there any CSS issues hiding the input?

**How to get connection name**: SchemaTree receives `connectionId` as a prop. Options:
1. Also pass `connectionName` as a prop from Sidebar.tsx
2. Look up the connection in connectionStore by ID inside SchemaTree

Option 2 is simpler since SchemaTree already uses stores.

## References

- Contract: `docs/sprints/sprint-42/contract.md`
- Relevant files:
  - `src/components/SchemaTree.tsx` — UUID 표시, 테이블 검색
  - `src/components/Sidebar.tsx` — SchemaTree에 props 전달
  - `src/stores/connectionStore.ts` — 연결 이름 조회
