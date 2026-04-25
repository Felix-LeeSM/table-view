# Sprint 101 → next Handoff

## Sprint 101 Result
- **PASS** (8.75/10, 1 attempt)
- 4 AC 모두 PASS, 회귀 0 (1749 / 1749 tests, +5 신규).

## 산출물
- `src/lib/strings/document.ts` (신규): `COLLECTION_READONLY_BANNER_TEXT` 상수 — i18n 친화 단일 소스.
- `src/components/document/CollectionReadOnlyBanner.tsx` (신규):
  - `role="status"` + `aria-live="polite"`, AlertTriangle 아이콘.
  - amber/warning tone (`bg-warning/10 border-warning/30 text-warning`).
  - Non-dismissible (close 버튼 없음).
  - `message?` prop 으로 override 가능.
- `src/components/DocumentDataGrid.tsx` (line 229-230): 그리드 root flex 컨테이너 첫 자식으로 마운트.
- `src/components/document/__tests__/CollectionReadOnlyBanner.test.tsx` (신규, 3 케이스).
- `src/components/DocumentDataGrid.test.tsx`: 배너 가시성 단언 1.
- `src/components/DataGrid.test.tsx` (line 1699-1707): RDB 에 배너 부재 회귀 가드.

## 인계
- **텍스트 선택 사유**: 원 spec 의 "Read-only — editing not yet supported" 는 sprint-87 의 cell-level edit + Add Document 출하 후 부정확. 권장 대안 "Beta — schema and DDL operations are not yet supported." 채택. findings.md 에 기록.
- **DDL kill-switch**: 향후 schema/index 편집 출하 시 배너 자동 숨김 — 현재는 항상 표시. `message?` prop 으로 컨디셔널 분기 가능 (또는 마운트 게이트 추가).
- **i18n 단일 export 확인**: grep 결과 동일 텍스트 다른 위치 중복 없음.
- **Color token 컨벤션**: `text-warning` 사용 (DataGridToolbar/DataGridTable/IndexesEditor 와 일관) — `text-warning-foreground` 가 아님.

## 다음 Sprint 후보
- sprint-102 ~ 123: 잔여 ui-evaluation findings.
- 후속: DDL 활성화 시 배너 게이트 후킹.
