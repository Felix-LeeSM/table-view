# Sprint 199 — Findings

Sprint: `sprint-199` (refactor — `SchemaTree.tsx` 2105-line god file 분해).
Date: 2026-05-02.
Status: closed.

## 0. 분해 전략 — entry-pattern 답습

### 발견

`SchemaTree.tsx` (2105 라인) 가 4 책임을 한 파일에 묶고 있었다:

1. **Pure helpers** — `rowCountLabel` / `rowCountText` / `nodeIdToString` /
   `getVisibleRows` (~190 라인). React import 0, store import 0 — 순수
   함수만.
2. **Action handlers + dialog state** — 12 handler (drop / rename /
   open structure / table click / view click / function click / refresh /
   ...) + `confirmDialog` / `renameDialog` state + Sprint 196 store-
   coupling 정책 (selector subscription, `getState()` 직접 호출 금지)
   (~480 라인).
3. **Row renderers + body** — leaf 5 renderer (schema / category /
   search / empty / item) + dispatcher + eager nested vs virtualized
   분기 (~810 라인).
4. **Dialog markup** — drop confirm + rename input dialog (~110 라인).

### 결정

Sprint 197 `mongodb.rs` 의 modern entry-pattern 을 답습 — `SchemaTree.tsx`
가 entry shell 로 남고, 같은 디렉토리 `SchemaTree/` 안에 책임별 sub-file
4 개. 외부 caller (`SchemaPanel.tsx`, `MainArea.tsx`) 는 `import SchemaTree
from "./SchemaTree"` 그대로 — 시그니처 / 위치 무변화 → AC-199-02 자동
충족.

| 파일 | 라인 | 책임 |
|------|------|------|
| `SchemaTree.tsx` (entry) | 419 | imports + props + cross-slice state + 3 useEffect + virtualizer wiring + return JSX shell (header + body + 두 dialog) |
| `SchemaTree/treeRows.ts` | 400 | pure helpers + types (`VisibleRow` / `BuildVisibleRowsArgs` / `NodeId` / `Category` / `CategoryKey`) |
| `SchemaTree/useSchemaTreeActions.ts` | 486 | hook — 12 handler (`useCallback`) + dialog state + tree UI state + selector subscription |
| `SchemaTree/rows.tsx` | 374 | 5 leaf renderer + dispatcher. `renderItemRow` 가 `flat=true` 모드 추가 — SQLite-shape 의 `pl-3` table-only 변형도 같은 함수가 처리 |
| `SchemaTree/body.tsx` | 473 | `<SchemaTreeBody>` (eager nested + virtualized 분기). `<SchemaSection>` / `<FlatTableList>` / `<CategoryCascade>` / `<CategorySection>` 4 sub-component 로 nesting 평탄화 + `pickCategoryItems` / `buildItemRow` helper 로 inline derivation 추출 |
| `SchemaTree/dialogs.tsx` | 165 | `<DropTableConfirmDialog>` + `<RenameTableDialog>` 두 컴포넌트 + state interface |

### 트레이드오프

- **5 sub-file 로 확장** — contract 는 "3~4 파일" 을 명시했지만 4-file
  구조에서는 `rows.tsx` 가 814 (700 cap 초과) 라 review 가 어려웠다
  ("개큰데" 피드백). leaf renderer (rows.tsx) 와 body 분기 (body.tsx) 를
  분리하면 책임도 더 명확 — rows = 한 행 렌더, body = layout 오케스트레
  이션. 분리 후 모든 파일이 700 이하로 들어옴.
- **body.tsx 의 4 sub-component 화** — eager nested 의 4 단 nesting
  (`schemas.map → schema div → category cascade → category content`) 을
  inline JSX 로 두면 indentation 만으로 압도적. `<SchemaSection>` /
  `<FlatTableList>` / `<CategoryCascade>` / `<CategorySection>` 로
  나누면 각 컴포넌트가 한 책임만 본다. props drilling (8~10 props) 가
  비용이지만 각 컴포넌트 props 가 SchemaTreeBody props 의 subset 이라
  spread (`{...props}`) 만으로 통과.
- **`pickCategoryItems` / `buildItemRow` helper** — pre-split 의 4-way
  ternary chain (`isTableCat ? schemaTables : isViewCat ? schemaViews : ...`)
  와 inline `nodeIdToString` 호출을 helper 함수로 추출. `pickCategoryItems`
  가 카테고리 → items / itemKind 매핑을 한 곳에 모음, `buildItemRow` 가
  `VisibleRow.item` 객체 생성을 한 곳에 모음.
- **handler `useCallback` 화** — pre-split 의 inline 함수가 useCallback
  으로 감싸지면서 dependency array 가 명시 필요. `expandedSchemas` 같은
  state 는 deps 에 등재 → 매 변경 시 새 callback. context 객체 (`ctx`)
  도 매 렌더 새로 만들어지지만 React 가 prop 변경을 감지해 re-render
  하는 건 이미 발생하던 paint 라 추가 비용 0 — `<SchemaTreeBody>` 내부
  도 memoization 없이 매 렌더 fresh closure.

## 1. effect 의존성 회귀 — `actions` 객체 통째 dep 금지

### 발견

entry 의 3 useEffect 가 `useSchemaTreeActions()` 의 결과 객체 `actions`
를 통째로 의존성으로 넣으면 매 렌더마다 effect 재실행 — 자동-펼침
effect 가 collapse 직후 다시 펼쳐서 schema toggle 가 동작 안 함.

### 결정

`actions` 에서 `schemas` / `setExpandedSchemas` / `refreshConnection`
3 필드를 destructure 한 뒤 effect deps 에 그 필드만 명시. setter 들은
`useState` 가 안정적 reference (React 보장) 라 재실행 트리거 안 됨.

```ts
const { schemas, setExpandedSchemas, refreshConnection } = actions;

useEffect(() => {
  // …
}, [refreshConnection]);          // stable

useEffect(() => {
  // …
}, [activeSchema, setExpandedSchemas]);

useEffect(() => {
  // …
}, [treeShape, schemas, setExpandedSchemas]);
```

### 트레이드오프

- **boilerplate destructure** — 3 필드 destructure 가 entry 상단에 추가.
  hook return 객체를 entry 가 그대로 분해하는 패턴 (Sprint 197 mongodb
  module 도 동일) — TypeScript 가 미사용 필드를 잡아내므로 silent drift
  없음.

## 2. row key 형식 — eager 와 virtualized 가 다름

### 발견

pre-split 의 eager nested 분기가 item 행의 React key 로 `${cat.key}-${item.
name}` (대시 구분자, schema 이름 없음) 을 썼고, `getVisibleRows` 가 만든
flat list 의 item key 는 `${cat.key}:${schema.name}:${item.name}` (콜론
구분자, schema 포함). 두 path 의 key 는 비교 대상이 아니라 React 가 각
list 안에서 sibling 식별만 하므로 별 문제 없으나, `renderItemRow` 가
`<ContextMenu key={row.key}>` 로 row 의 key 를 그대로 ContextMenu 에
부여하도록 통일.

### 결정

eager 분기에서 item 을 만들 때 `key: `${cat.key}-${item.name}`` 을 넘겨
주고, virtualized 분기에서는 `getVisibleRows` 가 만든 colon-format key
를 그대로 사용. 두 분기 다 자기 sibling list 안에서만 unique 하면 됨 —
React reconciliation 은 path 간 cross-checking 안 함.

### 트레이드오프

- **두 path 의 key 가 다른 점이 미묘한 latent bug 원인이 될 수 있음** —
  하지만 두 path 가 동시에 mount 되지 않으므로 실 위험 0. virtualized
  threshold (200 rows) 를 넘나들 때 React 가 전체 mount/unmount 하는
  점이 이미 그 분기 자체의 비용이라 key 형식 차이는 묻힘.

## 3. 검증 결과

### Frontend

| 검사 | 결과 |
|------|------|
| `pnpm vitest run` | **187 files / 2724 tests passed** (회귀 0) |
| `pnpm vitest run src/components/schema/SchemaTree*.test.tsx` | **6 files / 139 tests passed** (분해 직후 조기 검증) |
| `pnpm tsc --noEmit` | 0 errors |
| `pnpm lint` | 0 errors / 0 warnings |

신규 테스트 0 — 본 sprint 는 분해 only, 새 기능 / 새 case 가산 없음.

## 4. AC 별 evidence

| AC | 결과 |
|----|------|
| AC-199-01 | `SchemaTree.tsx` 2105 → 419 (-1686, -80%). 5 sub-file 신규 — `treeRows.ts` (400) / `useSchemaTreeActions.ts` (486) / `rows.tsx` (374) / `body.tsx` (473) / `dialogs.tsx` (165). 모든 파일 700 이하. contract "3~4 파일" 보다 1 개 추가 — findings §0 트레이드오프 참조. |
| AC-199-02 | `SchemaTreeProps { connectionId: string }` 시그니처 동일. `export default function SchemaTree(...)` 위치 동일 — `src/components/schema/SchemaTree.tsx`. 외부 caller (`SchemaPanel.tsx`) 무수정. |
| AC-199-03 | sub-file 5 인터페이스 명시 — 각 파일 최상단 JSDoc 에 책임 / dependency. `treeRows.ts` 가 React import 0 / store import 0 (pure). `useSchemaTreeActions.ts` 가 `addHistoryEntry` 를 selector subscription (직접 `getState()` 0). `rows.tsx` 의 leaf renderer 가 `ctx` prop 으로 handler 받음. `body.tsx` 가 leaf renderer 만 import (store hook 0). `dialogs.tsx` 가 props-driven (state 0). |
| AC-199-04 | 6 SchemaTree spec 무수정 통과 — `SchemaTree.test.tsx` (110 case) / `.preview.test.tsx` / `.virtualization.test.tsx` / `.dbms-shape.test.tsx` / `.rowcount.test.tsx` / `.preview.entrypoints.test.tsx` 합 139 case. DOM (aria-* / context menu / search filter / virtualization threshold) byte-for-byte 동등. |
| AC-199-05 | 후속 단순화 — (a) 신규 handler → `useSchemaTreeActions.ts` 만 수정, (b) 신규 row 종류 → `treeRows.ts` (`VisibleRow` union 확장) + `rows.tsx` (renderer 추가), (c) dialog 추가 → `dialogs.tsx`. `SchemaTree.tsx` entry 는 thin shell 로 거의 unchanged. |
| AC-199-06 | 위 검증 표 — vitest / tsc / lint 모두 zero error. baseline 무가산 (분해 only). |

## 5. CODE_SMELLS.md §1-1 frontend god file #1 부분 해소

- frontend 1 위 god file (`SchemaTree.tsx` 2105) → entry 419 + 5 sub-file
  로 분해. 다음 god file 후보:
  - `DataGridTable.tsx` (1071) — Sprint 201 후보
  - `QueryTab.tsx` (1040) — Sprint 203 후보
  - `tabStore.ts` (1002) — Sprint 205 후보

본 sprint 의 분해 패턴 (entry + `<File>/` sub-files, leaf renderer ↔ body
오케스트레이션 분리, hook + dialog 분리, body 안 sub-component + helper
추출) 이 후속 god file 분해의 reference. contract 단계에서 sub-file 수를
"3~5" 범위로 표기하면 단일 컴포넌트가 커도 700 cap 위반 없이 분해 가능.
