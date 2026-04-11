# Sprint Contract: sprint-6

## Summary

- Goal: QueryEditor 컴포넌트 테스트 추가 (0% → 70%+)
- Audience: Generator, Evaluator
- Owner: Claude Code
- Verification Profile: `command`

## In Scope

- QueryEditor.tsx CodeMirror 에디터 테스트
- MainArea.tsx 탭 라우팅 테스트
- 전체 커버리지 40% → 50%+ 상승 확인

## Out of Scope

- SchemaTree 테스트 (Sprint 7)
- Connection 컴포넌트 테스트 (Sprint 8)
- 커버리지 임계값 상향 (Sprint 종료 후)

## Invariants

- 기존 139개 테스트 모두 통과
- 프로덕션 코드 변경 없음 (테스트만 추가)
- CodeMirror 실제 생성 필요 — jsdom에서 EditorView 생성 가능해야 함

## Acceptance Criteria

- `AC-01`: QueryEditor가 `role="textbox"` + `aria-label="SQL Query Editor"` 컨테이너를 렌더링
- `AC-02`: 에디터 내용 변경 시 `onSqlChange` 콜백 호출
- `AC-03`: Mod-Enter 키 입력 시 `onExecute` 콜백 호출
- `AC-04`: 외부 `sql` prop 변경(탭 전환) 시 에디터 문서 내용 업데이트
- `AC-05`: MainArea가 활성 탭 없을 때 빈 상태 플레이스홀더 표시
- `AC-06`: MainArea가 table 탭에서 DataGrid + sub-tabs 렌더링
- `AC-07`: MainArea가 query 탭에서 QueryTab 렌더링
- `AC-08`: QueryEditor.tsx 라인 커버리지 70%+, MainArea.tsx 70%+
- `AC-09`: 전체 커버리지 lines 50%+ 도달

## Test Requirements

### Unit Tests (필수)
- AC-01~AC-04 각각 대응 QueryEditor 테스트
- AC-05~AC-07 각각 대응 MainArea 테스트

### Coverage Target
- QueryEditor.tsx: 70%+
- MainArea.tsx: 70%+

### Scenario Tests (필수)
- [x] Happy path: 에디터 렌더링, 탭 라우팅
- [x] 에러/예외: 빈 sql, undefined schemaNamespace
- [x] 경계 조건: 탭 전환, 컴포넌트 언마운트
- [x] 기존 기능 회귀 없음

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm vitest run --coverage` — QueryEditor 70%+, MainArea 70%+, 전체 50%+
3. `pnpm tsc --noEmit` — 타입 체크 통과

## Ownership

- Generator: general-purpose
- Write scope: `src/components/QueryEditor.test.tsx`, `src/components/MainArea.test.tsx`
- Merge order: 단일 커밋

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
