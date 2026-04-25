# Sprint Execution Brief: sprint-123 — Paradigm visual cues (TabBar icon + QueryLog badge)

## Objective

- `TabBar.tsx` — tab.paradigm = `"document"` 일 때 Mongo-specific icon 또는 "MQL" pill. RDB 는 Code2 / Table2 유지.
- `GlobalQueryLogPanel.tsx` — `paradigm` 뱃지 ("SQL"/"MQL") + `queryMode` secondary tag.
- 스토어/타입 변경 0 — read-only consumption.
- 신규 테스트 ≥ +4.

## Task Why

- Phase 6 plan F 의 마지막 사용자 지각 보강. 미수행 시 RDB+Mongo 탭이 시각적으로 구분 안 됨; query log 가 paradigm 메타를 보유 (Sprint 84) 하지만 미렌더.
- TabBar / QueryLog 는 paradigm-mixed aggregator (한 컨테이너가 모든 paradigm entry 모음) → 별도 viewer 분리 부적합. 공유 컴포넌트 + 안에서 paradigm-distinct 렌더링이 정합.
- sprint-120/121/122 의 폴더·leaf 분리 위에 마지막 시각 cue 마무리.

## Scope Boundary

- **Hard stop**:
  - `src/stores/queryHistoryStore.ts`, `src/stores/tabStore.ts` byte-identical
  - `src-tauri/**`
  - `src/components/datagrid/useDataGridEdit.ts`
  - `src/components/rdb/**` (sprint-120)
  - `src/components/document/AddDocumentModal.tsx` (sprint-121)
  - `src/components/document/DocumentFilterBar.tsx` (sprint-122)
  - `src/components/document/DocumentDataGrid.tsx` (sprint-120/121/122 누적 결과)
  - `src/lib/paradigm.ts`, `src/lib/mongo/mqlFilterBuilder.ts`, `src/lib/mongo/mqlGenerator.ts`
  - `src/hooks/useMongoAutocomplete.ts`
  - `src/components/connection/ConnectionDialog.tsx`
  - `src/components/query/QueryEditor.tsx`
- **Write scope**:
  - 수정: `src/components/layout/TabBar.tsx`
  - 수정: `src/components/query/GlobalQueryLogPanel.tsx`
  - 수정: `src/components/layout/TabBar.test.tsx` (extend)
  - 수정: `src/components/query/GlobalQueryLogPanel.test.tsx` (extend)

## Invariants

- 기존 RDB tab snapshot 동등 (DOM 동일성 유지)
- sprint-120/121/122 결과 byte-identical
- store/type 변경 0
- 신규 Tailwind 팔레트 0 — 기존 토큰만 사용
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors
- Vitest baseline (sprint-122 결과) + ≥ +4

## Done Criteria

1. Mongo connection tab 시각 구분; RDB tab pixel-identical (snapshot)
2. GlobalQueryLogPanel 이 paradigm 뱃지 (SQL/MQL) 렌더
3. queryMode 존재 시 secondary tag (find / aggregate / sql)
4. store/type 변경 0 (`git diff` 검증)
5. 신규 Tailwind 팔레트 0 — `bg-secondary` / `text-secondary-foreground` 등 기존 토큰만
6. A11y `aria-label` 부착 (icon-only 영역)
7. sprint-120/121/122 결과 byte-identical
8. 신규 테스트 ≥ +4

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm tsc --noEmit` → 0 errors
  2. `pnpm lint` → 0 errors
  3. `pnpm vitest run` → baseline + ≥ +4 신규
  4. `git diff --stat HEAD -- src/stores/queryHistoryStore.ts src/stores/tabStore.ts src-tauri/ src/components/datagrid/useDataGridEdit.ts src/components/rdb/ src/components/document/AddDocumentModal.tsx src/components/document/DocumentFilterBar.tsx src/components/document/DocumentDataGrid.tsx src/lib/paradigm.ts src/lib/mongo/mqlFilterBuilder.ts src/lib/mongo/mqlGenerator.ts` → empty
- **Required evidence**:
  - TabBar 의 paradigm 분기 file:line + 사용 icon
  - GlobalQueryLogPanel 의 paradigm 뱃지 + queryMode tag file:line
  - RDB tab snapshot 동등 증거 (테스트 출력)
  - 신규 4 테스트 이름 + AC 매핑
  - hard-stop diff empty 캡처

## Evidence To Return

- 변경 파일 목록 + 목적 (수정 4)
- 4 check 의 실행 명령 + 결과 수치
- AC-01 ~ AC-08 별 file:line 또는 test name
- Assumptions:
  - icon 선택은 lucide-react 의 `Database` / `Leaf` 등 기존 import 활용; 신규 dep 0
  - 뱃지 텍스트는 "SQL" / "MQL" 단순 라벨; queryMode 는 `find` / `aggregate` / `sql` raw 표시
  - RDB 측 paradigm cue 추가 시 빈 fragment 또는 동일 wrapper 로 DOM 동일성 유지 (snapshot 회귀 회피)
- Residual risk:
  - 미래 paradigm (search/kv) 의 시각 cue 는 본 sprint 에서 미정의 — `assertNever` (sprint-120 도입) 또는 런타임 fallback 으로 처리
  - 다른 색상 톤 요청 시 후속 sprint 에서 팔레트 토큰 추가

## References

- Master plan: `~/.claude/plans/idempotent-snuggling-brook.md`
- Contract: `docs/sprints/sprint-123/contract.md`
- Findings: `docs/sprints/sprint-123/findings.md` (Generator 작성)
- Handoff: `docs/sprints/sprint-123/handoff.md` (Generator 작성)
- Relevant files:
  - `src/components/layout/TabBar.tsx` (수정)
  - `src/components/layout/TabBar.test.tsx` (extend)
  - `src/components/query/GlobalQueryLogPanel.tsx` (수정)
  - `src/components/query/GlobalQueryLogPanel.test.tsx` (extend)
  - `src/stores/queryHistoryStore.ts` (read-only)
  - `src/stores/tabStore.ts` (read-only)
