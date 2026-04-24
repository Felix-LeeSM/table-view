# Sprint Execution Brief: sprint-71 (Phase 6 plan D-2)

## Objective

- Sprint 70 에서 완성된 `BsonTreeViewer` 를 실제 앱 경로에 배선한다.
- `QuickLookPanel` 을 paradigm-aware 하게 만들고, `DocumentDataGrid` 가 **행 선택 + Cmd+L + Quick Look 마운트** 를 지원하도록 확장한다.
- `DocumentDataGrid` 의 sentinel 판정을 `isDocumentSentinel()` 헬퍼로 교체한다.

## Task Why

- `paradigm === "document"` 탭은 Sprint 66 에서 read-only grid까지만 배선됨. 중첩 BSON 구조를 확인할 경로가 없어 TablePlus 사용자 체감상 "셀이 `{...}` 로 축약되지만 그 내부를 볼 방법이 없는" 상태.
- Sprint 70 이 `BsonTreeViewer` 를 만들어 두었으니, 이번 스프린트는 **"배선만"** 수행해 사용자가 RDB 와 동일한 흐름(행 클릭 → Cmd+L → 상세)으로 문서 탐색 가능하게 만든다.
- Sprint 72(Find/Aggregate 쿼리 모드) 가 동일한 QuickLookPanel + selection 인프라를 재사용하므로 여기서 공고화해 둬야 후속 스프린트가 단순해짐.

## Scope Boundary

**수정 허용**:
- `src/components/shared/QuickLookPanel.tsx` — discriminated union props + document 분기.
- `src/components/shared/QuickLookPanel.test.tsx` — 기존 테스트 보존 + document mode describe 블록 추가.
- `src/components/DocumentDataGrid.tsx` — selection state, Cmd+L, QuickLookPanel mount, `isDocumentSentinel()` 교체, 페이지 전환 시 selection reset.

**신규 생성**:
- `src/components/DocumentDataGrid.test.tsx` — 최소 6 테스트.

**절대 수정 금지 (diff 0)**:
- `src/components/DataGrid.tsx`, `src/components/datagrid/**` (RDB 경로)
- `src/components/shared/BsonTreeViewer.tsx`, `src/components/shared/BsonTreeViewer.test.tsx` (Sprint 70 확정)
- `src/types/document.ts`, `src/stores/documentStore.ts`, `src/stores/tabStore.ts`
- `src-tauri/**` — Rust 변경 전혀 없음.

## Invariants

- RDB DataGrid 경로 완전 동일. `DataGrid.tsx:383` 에서 `<QuickLookPanel data=... selectedRowIds=... schema=... table=... onClose=... />` 를 `mode` 없이 호출해도 기본 `"rdb"` 로 동작.
- 기존 `QuickLookPanel.test.tsx` 15 테스트 수정 없이 전부 통과.
- `DocumentDataGrid` 기존 read 경로 (runFind, 페이지네이션, 에러/로딩 상태) 동작 유지.
- React convention 준수 (함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix).
- jsdom + vitest 4 + user-event 14 의 clipboard 함정 — Sprint 70 에서 `Object.defineProperty(navigator, "clipboard", ...)` 재설치 패턴이 확립됨. 이번 스프린트는 clipboard 상호작용이 핵심이 아니므로 특별한 주의 불필요.

## Done Criteria

1. `QuickLookPanel` 이 `mode?: "rdb" | "document"` discriminated union 으로 확장되어 기존 호출과 호환되고, document 모드에서 `BsonTreeViewer` 를 마운트한다.
2. `DocumentDataGrid` 에서 행 클릭 → 선택 상태 토글, Cmd+L → Quick Look 토글, 선택+토글 ON 일 때만 `QuickLookPanel (mode="document")` 가 마운트된다.
3. `DocumentDataGrid` 의 센티널 판정이 `isDocumentSentinel()` 헬퍼로 일원화된다 (인라인 정규식 제거).
4. 페이지 전환 시 `selectedRowIds` 가 빈 Set 으로 리셋.
5. `QuickLookPanel.test.tsx` 에 document mode describe 블록 5+ 테스트 추가 (기존 15 테스트 보존).
6. `DocumentDataGrid.test.tsx` 신규 6+ 테스트.
7. 5개 generator-scope verification check 전부 통과.
8. 변경 범위 바깥 파일 diff 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `cd src-tauri && cargo fmt --all -- --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
  5. `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx src/components/DocumentDataGrid.test.tsx`
- Orchestrator-scope:
  - `cd src-tauri && cargo test --lib`
  - `pnpm vitest run` (전체 suite)
- Required evidence:
  - 변경 파일 경로 + 역할.
  - 각 AC → 테스트 이름 + 파일:라인 매핑.
  - discriminated union 타입 정의 코드 위치 (file:line-range).
  - `DocumentDataGrid` 의 selection, Cmd+L, mount, sentinel 교체 각 위치.

## Evidence To Return

- Changed files and purpose (수정 vs 신규).
- Generator-scope 5 checks: 실행 커맨드 + 핵심 수치 (테스트 pass 수, clippy warning 수, lint error 수).
- 각 AC 대응 테스트 이름 나열.
- `QuickLookPanel` props union 정의 file:line-range.
- `DocumentDataGrid` 주요 변경 위치 (selection state, Cmd+L handler, mount condition, `isDocumentSentinel` import).
- Invariant 확인: `DataGrid.tsx`, `BsonTreeViewer.tsx`, `useDataGridEdit.ts`, `src-tauri/**` diff 0 을 git stat 으로 검증.
- Assumptions: 단일 행 선택만 지원 (재클릭=해제), 페이지 전환 = 선택 리셋, 키보드 행 이동 out of scope.
- Residual risk: RDB 그리드는 `DataGridTable` 의 복잡한 selection 로직을 사용하는 반면 DocumentDataGrid 는 local state 기반 → 향후 편집 지원 추가 시 (Sprint 73) selection 로직이 `useDataGridEdit` 와 호환되도록 재조직 필요.

## References

- Contract: `docs/sprints/sprint-71/contract.md`
- Sprint 70 handoff (뷰어 구현): `docs/sprints/sprint-70/handoff.md`
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint D 섹션, D-1/D-2 분할 주석)
- Relevant files (read-only reference):
  - `src/components/shared/BsonTreeViewer.tsx` (Sprint 70 최종본, 450줄)
  - `src/types/document.ts` (isDocumentSentinel, DocumentQueryResult, raw_documents)
  - `src/stores/documentStore.ts` (queryResults 셀렉터)
  - `src/components/DataGrid.tsx` (기존 Cmd+L 구현 패턴 참고)
  - `src/components/DocumentDataGrid.tsx` (현재 본체, 수정 대상)
  - `src/components/shared/QuickLookPanel.tsx` (현재 본체, 수정 대상)
  - `src/components/shared/QuickLookPanel.test.tsx` (보존해야 할 15 테스트)
