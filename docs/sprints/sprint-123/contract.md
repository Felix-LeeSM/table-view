# Sprint Contract: sprint-123 — Paradigm visual cues (TabBar icon + QueryLog badge)

## Summary

- **Goal**: TabBar 와 GlobalQueryLogPanel 에 paradigm 시각 cue 추가. 두 surface 는 paradigm-mixed aggregator (한 컨테이너가 모든 paradigm 의 entry 표시) → 공유 컴포넌트 안에서 인라인 paradigm-distinct 렌더링. 스토어/타입 변경 0.
- **Audience**: Frontend (React/TypeScript, Tailwind, A11y)
- **Owner**: Generator (sprint-123)
- **Verification Profile**: `command`

## In Scope

- 수정:
  - `src/components/layout/TabBar.tsx` (L194-197 부근) — tab.paradigm = `"document"` 일 때 Mongo-specific icon (Leaf / Database 변형) 또는 작은 "MQL" pill. RDB 는 Code2 / Table2 유지.
  - `src/components/query/GlobalQueryLogPanel.tsx` — `paradigm === "rdb"` → "SQL" 뱃지, `paradigm === "document"` → "MQL" 뱃지. `entry.queryMode` 존재 시 secondary tag.
  - `src/components/layout/TabBar.test.tsx` (extend)
  - `src/components/query/GlobalQueryLogPanel.test.tsx` (extend)
- Tailwind 토큰 재사용 (`bg-secondary` / `text-secondary-foreground`) — 신규 팔레트 0
- A11y: icon `aria-label` ("MongoDB collection tab" / "Relational table tab"); 뱃지 plain text

## Out of Scope

- `queryHistoryStore.ts`, `tabStore.ts` 변경 (read-only consumption)
- 신규 컴포넌트 신설
- 새 Tailwind 팔레트
- `useDataGridEdit.ts` 변경
- search/kv paradigm 의 시각 cue (해당 viewer sprint 에서)

## Invariants

- `src/stores/queryHistoryStore.ts`, `src/stores/tabStore.ts` byte-identical
- `src-tauri/**` byte-identical
- `src/components/datagrid/useDataGridEdit.ts` byte-identical
- sprint-120/121/122 결과 byte-identical:
  - `src/components/rdb/**`
  - `src/components/document/AddDocumentModal.tsx`
  - `src/components/document/DocumentFilterBar.tsx`
  - `src/components/document/DocumentDataGrid.tsx`
  - `src/lib/paradigm.ts`
  - `src/lib/mongo/mqlFilterBuilder.ts`
  - `src/lib/mongo/mqlGenerator.ts`
- 기존 RDB 탭 snapshot 동등 — RDB 측은 빈 fragment 또는 동일 marker 로 DOM 동일하게 유지
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors

## Acceptance Criteria

- `AC-01`: Mongo connection tab 이 시각 구분 (Leaf / Database 변형 또는 "MQL" pill); RDB tab pixel-identical to pre-sprint (snapshot)
- `AC-02`: `GlobalQueryLogPanel` 이 `paradigm === "rdb"` → "SQL" 뱃지, `paradigm === "document"` → "MQL" 뱃지 렌더
- `AC-03`: `entry.queryMode` (find / aggregate / sql) 존재 시 paradigm 뱃지 옆 secondary tag 렌더
- `AC-04`: store / type 변경 0 — read-only consumption (`git diff --stat HEAD -- src/stores/queryHistoryStore.ts src/stores/tabStore.ts` empty)
- `AC-05`: 뱃지가 기존 Tailwind 토큰 (`bg-secondary` / `text-secondary-foreground`) 사용 — 신규 팔레트 0
- `AC-06`: A11y — icon 에 `aria-label` 부착; 뱃지 plain text
- `AC-07`: sprint-120/121/122 결과 byte-identical 보존
- `AC-08`: 신규 테스트 ≥ +4 (tab icon per paradigm, RDB tab snapshot parity, log badge SQL/MQL, queryMode tag)

## Design Bar / Quality Bar

- 시각 cue 가 "조용함" — 강한 색대비/큰 아이콘 회피, 본 UI 위계 보존
- RDB 측은 Code2 / Table2 유지 — Mongo 측 추가만; 빈 fragment 또는 동일 wrapper 로 DOM 동일성 유지
- A11y: icon-only 인 경우 `aria-label`; 뱃지는 텍스트라 별도 속성 불필요
- 다크 모드 동등

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 0 errors
2. `pnpm lint` → 0 errors
3. `pnpm vitest run` → baseline (sprint-122 결과) + ≥ +4 신규
4. `git diff --stat HEAD -- src/stores/queryHistoryStore.ts src/stores/tabStore.ts src-tauri/ src/components/datagrid/useDataGridEdit.ts src/components/rdb/ src/components/document/AddDocumentModal.tsx src/components/document/DocumentFilterBar.tsx src/components/document/DocumentDataGrid.tsx src/lib/paradigm.ts src/lib/mongo/mqlFilterBuilder.ts src/lib/mongo/mqlGenerator.ts` → empty

### Required Evidence

- Generator must provide:
  - TabBar 의 paradigm 분기 file:line + 사용한 icon
  - GlobalQueryLogPanel 의 paradigm 뱃지 + queryMode tag file:line
  - 신규 4 테스트 이름 + AC 매핑
  - RDB tab snapshot 동등 증거 (테스트 출력)
  - 4 check 결과 캡처
- Evaluator must cite:
  - 각 AC 별 file:line 또는 test name
  - hard-stop diff empty 증거
  - A11y label 명시 위치

## Test Requirements

### Unit Tests (필수)
- TabBar.test.tsx: paradigm = "document" 일 때 새 cue 렌더 / paradigm = "rdb" 일 때 기존 동일 (snapshot 또는 byte-identical 검증)
- GlobalQueryLogPanel.test.tsx: paradigm 뱃지 SQL/MQL 케이스, queryMode tag 케이스

### Coverage Target
- 신규 코드: 라인 70% 이상
- CI baseline 유지

### Scenario Tests (필수)
- [x] Happy path: Mongo tab cue + log SQL/MQL 뱃지
- [x] 에러: queryMode 누락 시 secondary tag 미렌더
- [x] 경계: paradigm 이 미정의 (= 미래 search/kv) 일 때 — `assertNever` 가 컴파일 타임에 잡거나, 런타임에선 fallback (empty fragment) 으로 처리
- [x] 회귀: RDB tab snapshot 동일

## Test Script / Repro Script

1. `pnpm tauri dev` → RDB connection 1개 + Mongo connection 1개 추가
2. RDB 테이블 탭 + Mongo collection 탭 둘 다 열기 → TabBar 에서 시각 구분 확인
3. RDB 쿼리 실행 + Mongo find 실행 → GlobalQueryLogPanel 열기 → 각 항목 SQL/MQL 뱃지 + queryMode tag 확인

## Ownership

- **Generator**: sprint-123 generator
- **Write scope**:
  - 수정: `TabBar.tsx`, `GlobalQueryLogPanel.tsx`, 두 짝 테스트
- **Merge order**: sprint-120 → 121 → 122 → 123 (마지막)

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- Phase done — 사용자가 mongo collection 의 read/write 흐름 + paradigm 시각 구분 모두 가능
