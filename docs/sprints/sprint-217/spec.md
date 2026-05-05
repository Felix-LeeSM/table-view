# Feature Spec: DocumentDatabaseTree god-file split (Sprint 217 — retroactive)

> **Retroactive note**: 본 sprint 의 작업은 Sprint 212 (P3 tabStore cross-store) 진행 중 Generator 가 P9 사전 처리로 함께 수행. 별도 atomic commit 분리는 sub-file dependency 로 인한 build 무결성 비용이 audit trail 이득보다 커서 단일 commit 통합. PLAN.md 의 Sprint 212 + Sprint 217 두 행이 동일 hash 가리킴.

## Description

`src/components/schema/DocumentDatabaseTree.tsx` (582 lines) 가 다음 7 concern 을 단일 파일에 보유: (1) `useDocumentStore` databases / collections selector + load 호출 + 자동 expand, (2) tree 의 검색 필터링 (database name + collection name OR-match + 자동 부모 expand), (3) `DatabaseRow` / `CollectionRow` presentational rendering with chevron / icon / loading / context-menu wiring, (4) Safe Mode gate + `dropCollection` Tauri call + Mongo history record + toast, (5) 두 tab-open handler (single click `addTab` preview / double click `addTab` persistent), (6) destructive `DropCollectionDialog` markup, (7) localStorage activeDb 추적.

본 sprint 는 god component 를 entry-pattern 으로 분해 — 행동 변경 0, 외부 import path 보존, 21-test regression 통과 유지.

## Sprint Breakdown

### Sprint 217: DocumentDatabaseTree entry-pattern split

**Goal**: `DocumentDatabaseTree.tsx` (582) 를 entry (< 300 lines) + 4 sub-file (`useDocumentDatabaseTreeData` / `useDocumentDatabaseDrop` / `rows` / `dialogs`) 로 분해. entry 는 두 hook 호출 + 두 row 컴포넌트 + 한 dialog 만 wiring 보존. 행동 변경 0. 21건 회귀 통과.

**Verification Profile**: command

**Acceptance Criteria**:

1. **Entry path + props 보존.** `src/components/schema/DocumentDatabaseTree.tsx` 가 default export. Props = `{ connectionId: string }`. 외부 importer (`Sidebar.tsx`) 변경 0.
2. **5 파일 모두 존재 + 비어있지 않음.** entry + 4 sub-file (`useDocumentDatabaseTreeData.ts` + `useDocumentDatabaseDrop.ts` + `rows.tsx` + `dialogs.tsx`).
3. **Entry < 300 lines, 단일 sub-file < 300 lines.** 582 → 263 + (205, 109, 130, 67) 분배.
4. **회귀 테스트 통과.** `DocumentDatabaseTree.test.tsx` 21건 변경 0 + 통과.
5. **프로젝트 회귀 0.** `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` exit 0.

**Components to Create/Modify**:

- `src/components/schema/DocumentDatabaseTree.tsx` (modify): entry. 두 hook 호출 (`useDocumentDatabaseTreeData(connectionId)`, `useDocumentDatabaseDrop(connectionId)`) + 두 row 컴포넌트 인스턴스 + 한 dialog 마운트 + tab-open inline wrapper (5-line) 만 보존. (Sprint 212 P3 작업 — `useMruStore` selector + `markConnectionUsed` 호출 추가 — 같은 commit 에 통합.)
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseTreeData.ts` (create, ~205): databases / collections selector + `loadDatabases` / `loadCollections` + 검색 필터 + 자동 expand + activeDb 추적.
- `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseDrop.ts` (create, ~109): Safe Mode gate + `dropCollection` + history record + toast.
- `src/components/schema/DocumentDatabaseTree/rows.tsx` (create, ~130): `DatabaseRow` + `CollectionRow` presentational.
- `src/components/schema/DocumentDatabaseTree/dialogs.tsx` (create, ~67): destructive `DropCollectionDialog`.

## Global Acceptance Criteria

1. **행동 변경 0.** 21건 regression test 모두 통과: tree expand / collapse / 검색 / single-click select / double-click open / drop collection (Safe Mode allow / block) / loading / error / refresh.
2. **외부 import path 보존.** `Sidebar.tsx` 의 `import DocumentDatabaseTree from "@components/schema/DocumentDatabaseTree"` 변경 0.
3. **Sub-file internal.** 4 sub-file 은 entry 로부터만 import, 외부 노출 0.
4. **새 `eslint-disable*` 0, 새 silent `catch{}` 0.**
5. **MRU marking 발화 보존 (Sprint 212 통합).** `handleCollectionOpen` / `handleCollectionDoubleClick` 두 handler 가 `markConnectionUsed(connectionId)` 호출.

## Data Flow

- entry `<DocumentDatabaseTree connectionId>` mount.
- entry 가 `useDocumentDatabaseTreeData(connectionId)` 호출 → tree state (databases / collections / expandedDbs / search query / loading / error) 반환.
- entry 가 `useDocumentDatabaseDrop(connectionId)` 호출 → `{ dropTarget, openDrop, confirmDrop, cancelDrop }` 반환.
- entry 가 filtered tree 를 `<DatabaseRow>` / `<CollectionRow>` 로 렌더 + drop dialog 마운트.
- single click → `addTab` preview + `markConnectionUsed`.
- double click → `addTab` persistent + `markConnectionUsed`.
- right click + Drop Collection → `openDrop` → Safe Mode `decide` → `confirmDrop` → `dropCollection` Tauri → toast + history record + reload.

## UI States

- **로딩**: `<Loader2>` spinner.
- **에러**: 에러 메시지 + retry 버튼.
- **빈 상태**: "No databases" 텍스트.
- **검색 매칭**: 부모 db 자동 expand + 텍스트 highlight.
- **드롭 다이얼로그**: 빨간 destructive 스타일 + collection 이름 명시.

## Edge Cases

- 검색어가 db 이름만 매치 → db 노드만 highlight, collections 안 expand.
- 검색어가 collection 이름 매치 → 부모 db 자동 expand + collection 노드 highlight.
- Safe Mode block → drop dialog 안 열림, toast.error.
- Drop 중 사용자가 다른 db 선택 → drop 완료 후 refresh, race 없음.
- 빠른 더블클릭 → preview tab 한 번만 promote.

## Verification Hints

- `wc -l src/components/schema/DocumentDatabaseTree.tsx` < 300 (실제 263).
- `ls src/components/schema/DocumentDatabaseTree/{useDocumentDatabaseTreeData.ts,useDocumentDatabaseDrop.ts,rows.tsx,dialogs.tsx}` 모두 존재.
- `pnpm vitest run src/components/schema/DocumentDatabaseTree.test.tsx` exit 0 (21건).
- `pnpm vitest run` exit 0.
- `pnpm tsc --noEmit && pnpm lint` exit 0.
- `grep -rn "from \"@components/schema/DocumentDatabaseTree/" src/ e2e/` 0 매치 (sub-file internal).
