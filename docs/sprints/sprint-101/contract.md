# Sprint Contract: sprint-101

## Summary
- Goal: MongoDB 컬렉션 탭 상단에 sticky 배너 — beta/제한 안내. Non-dismissible. RDB 탭 제외.
- Profile: `command` (DOM assertion via Vitest + RTL)

## Background note
- 원 spec 은 "Read-only — editing not yet supported" 텍스트를 명시하나 sprint-87 에서 cell-level editing + Add Document 가 이미 출하됨. 따라서 텍스트는 현재 상태를 반영해야 함 — Generator 가 다음 중 하나 선택:
  - **권장**: "Beta — schema and DDL operations are not yet supported."
  - 대안: "Beta — limited editing support."
  - 대안: "MongoDB collections are in beta. Some operations may be unsupported."
- 정확한 문구 결정은 Generator 가 findings 에 사유 기록.

## In Scope
- 새 컴포넌트 `src/components/document/CollectionReadOnlyBanner.tsx`:
  - Props: `{ message?: string }` (default = 상수에서).
  - 시각: `bg-warning/10 text-warning-foreground` 또는 동등 amber/yellow tone, `border-b`, sticky top.
  - `role="status"`, `aria-live="polite"` (또는 `role="banner"`).
  - Non-dismissible — close button 없음.
- 새 상수 모듈 `src/lib/strings/document.ts` (또는 기존 `src/lib/strings.ts`):
  - `COLLECTION_READONLY_BANNER_TEXT` export.
- `src/components/DocumentDataGrid.tsx`:
  - 그리드 최상단 (toolbar 위 또는 바로 아래) 에 `<CollectionReadOnlyBanner />` 마운트.
- `src/components/DocumentDataGrid.test.tsx`: 배너 가시성 단언.
- `src/components/DataGrid.test.tsx`: RDB 그리드에는 배너 없음 단언 (회귀 가드).
- `src/components/document/__tests__/CollectionReadOnlyBanner.test.tsx` (선택): 단위 테스트.

## Out of Scope
- DDL/schema editing 활성화 (out of scope, 안내 텍스트만).
- Banner dismiss 메커니즘.
- sprint-88~100 산출물 추가 변경.
- `CLAUDE.md`, `memory/`.

## Invariants
- 회귀 0 (1744 + 신규 통과).
- DocumentDataGrid 의 기존 편집/페이징/Quick Look 동작 보존.
- sprint-87 의 cell-level editing, Add Document 동작 보존.

## Acceptance Criteria
- AC-01: MongoDB 컬렉션 탭 상단에 배너 (`role="status"` 또는 `role="banner"`) 노출 — 텍스트는 상수에서 import.
- AC-02: 배너에 close/dismiss 버튼 부재. 탭 전환 후 재진입 시에도 항상 보임 (mount/unmount 라이프사이클로 자동 재렌더, 로컬 상태 없음).
- AC-03: RDB 그리드 (`DataGrid`) 에는 배너 미렌더 — `queryByRole("status")` 또는 텍스트 부재 단언.
- AC-04: 배너 텍스트가 별도 상수 파일에서 import 되어 i18n 친화적 위치.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Test Requirements
- AC-01: DocumentDataGrid 마운트 후 `getByRole("status"|"banner")` + 상수 텍스트 단언.
- AC-02: dismiss 버튼 부재 (`queryByRole("button", { name: /dismiss|close/i })` null).
- AC-03: DataGrid 마운트 후 `queryByText(상수)` null.
- AC-04: 상수가 별도 파일에서 export 되는지 (import 단언) — 또는 텍스트 일치로 간접 단언.

## Exit Criteria
- P1/P2 findings: 0
- All checks pass
