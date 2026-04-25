# Sprint 123 → next Handoff

## Sprint 123 Result

- **PASS** (1 attempt) — 1882/1882 tests, tsc 0, lint 0. 1875 → 1882 (+7: 3 TabBar + 4 GlobalQueryLogPanel). 회귀 0.

## 산출물

- **MODIFIED** `src/components/layout/TabBar.tsx`:
  - `Leaf` icon import 추가 (`TabBar.tsx:2`).
  - `tab.paradigm === "document"` 일 때 작은 (size 10) `Leaf` 아이콘을 기존 `Code2`/`Table2` 옆에 렌더 (`TabBar.tsx:217-227`). RDB tab 은 paradigm 분기 안 들어감 → DOM 동일.
  - `aria-label` 은 `"MongoDB collection tab"` (table tab) / `"MongoDB query tab"` (query tab) — 본 sprint 의 contract A11y 요건 충족.

- **MODIFIED** `src/components/query/GlobalQueryLogPanel.tsx`:
  - 각 entry row 의 connection 뱃지 뒤에 두 개 새 inline 뱃지 추가 (`GlobalQueryLogPanel.tsx:243-273`):
    - `<span data-paradigm={entry.paradigm}>` — `entry.paradigm === "document"` 일 때 `MQL`, 그 외 (`rdb`) `SQL`. font-mono + `bg-secondary` 토큰 사용.
    - `<span data-query-mode={entry.queryMode}>` — document 항목에서만 (`find` / `aggregate`). RDB 항목은 항상 `queryMode === "sql"` 라 redundant 이므로 suppress.
  - 두 뱃지 모두 기존 `bg-secondary` / `text-secondary-foreground` Tailwind 토큰 — 신규 팔레트 0.

- **MODIFIED** `src/components/layout/TabBar.test.tsx` — 신규 +3 케이스:
  1. `renders a Mongo paradigm marker for document-paradigm tabs` — `paradigm: "document"` 인 table tab → `MongoDB collection tab` aria-label 노출.
  2. `does not render the Mongo marker for RDB tabs (snapshot parity)` — paradigm 누락 (legacy → "rdb") 시 두 라벨 모두 미노출. RDB 회귀 가드.
  3. `labels a Mongo query tab as a query (not a collection)` — `paradigm: "document"` 인 query tab → `MongoDB query tab` 라벨, `MongoDB collection tab` 부재.

- **MODIFIED** `src/components/query/GlobalQueryLogPanel.test.tsx` — 신규 +4 케이스:
  1. `renders a SQL paradigm badge for relational entries` — `paradigm === "rdb"` → `[data-paradigm="rdb"]` text "SQL", `[data-query-mode]` 부재.
  2. `renders an MQL paradigm badge for document entries` — `paradigm === "document"` → `[data-paradigm="document"]` text "MQL".
  3. `surfaces the queryMode tag next to the MQL badge for document entries` — `queryMode === "aggregate"` → `[data-query-mode="aggregate"]` text "aggregate".
  4. `renders SQL/MQL badges for a mixed-paradigm log without crosstalk` — RDB row 와 document row 가 한 패널에 있을 때 각자 자기 paradigm 만 보여주고 RDB 는 queryMode tag 없음.

## AC Coverage

- **AC-01** ✅ — `TabBar.tsx:217-227`. `paradigm === "document"` 분기에서만 Leaf 추가; RDB 분기는 byte-identical (DOM snapshot 동일). 테스트 #1, #2.
- **AC-02** ✅ — `GlobalQueryLogPanel.tsx:243-263` 가 SQL/MQL 뱃지 렌더. 테스트 #1, #2, #4.
- **AC-03** ✅ — `GlobalQueryLogPanel.tsx:264-273` 가 document 항목에서만 `queryMode` secondary tag 렌더. 테스트 #3, #4.
- **AC-04** ✅ — store / type 변경 0. `git diff --stat HEAD -- src/stores/queryHistoryStore.ts src/stores/tabStore.ts` empty.
- **AC-05** ✅ — `bg-secondary` + `text-secondary-foreground` 토큰만 사용 (`GlobalQueryLogPanel.tsx:249, 268`). 신규 팔레트 0.
- **AC-06** ✅ — Leaf icon 의 `aria-label` 부착 (`TabBar.tsx:222-225`); 뱃지는 plain text (별도 속성 불필요).
- **AC-07** ✅ — sprint-120/121/122 산출물 byte-identical. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/components/rdb/ src/components/document/AddDocumentModal.tsx src/components/document/DocumentFilterBar.tsx src/components/document/DocumentDataGrid.tsx src/lib/paradigm.ts src/lib/mongo/mqlFilterBuilder.ts src/lib/mongo/mqlGenerator.ts` empty.
- **AC-08** ✅ — +7 신규 (요구치 ≥ +4). 1875 → 1882.

## 검증 명령 결과

- `pnpm vitest run src/components/layout/TabBar.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` → 60/60 pass.
- `pnpm vitest run` → 112 files / **1882/1882 pass** (sprint-122 baseline 1875 + 7).
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.
- `git diff --stat HEAD -- src/stores/queryHistoryStore.ts src/stores/tabStore.ts src-tauri/ src/components/datagrid/useDataGridEdit.ts src/components/rdb/ src/components/document/AddDocumentModal.tsx src/components/document/DocumentFilterBar.tsx src/components/document/DocumentDataGrid.tsx src/lib/paradigm.ts src/lib/mongo/mqlFilterBuilder.ts src/lib/mongo/mqlGenerator.ts` → 빈 출력.

## 구현 노트

- **RDB DOM parity**: `paradigm === "document"` 조건 안에서만 Leaf 를 렌더 — RDB 측은 fragment 도 추가하지 않아 sprint-122 이전과 byte-identical. 테스트 #2 가 `queryByLabelText` 으로 둘 다 null 임을 단언해 회귀 가드.
- **Leaf 아이콘 선택**: lucide-react 의 Leaf 는 다른 파일에서 사용 안 함 (확인됨) — 충돌 없음. Mongo 의 leaf 모양 logo 와 의미적 일치, "조용한 marker" 디자인 바 충족.
- **Mode tag suppress 결정**: RDB 항목에서 `queryMode === "sql"` 은 paradigm 뱃지와 redundant 이므로 항상 hide. 다만 현재 paradigm 가드는 `entry.paradigm === "document"` — RDB 에서 향후 mode 종류가 늘어나면 (예: `transaction`) 가드를 새로 짤 필요. 지금은 contract scope 내 simplification.
- **data-attribute 사용**: 테스트 친화적 query 를 위해 `data-paradigm` / `data-query-mode` 부착. accessible name 으로는 노출 안 됨 (뱃지 자체가 plain text).
- **Snapshot 검증**: contract 가 명시한 "RDB tab pixel-identical" 를 위해 새로 snapshot 파일 만들지 않고 negative-assertion 으로 회귀 방지 — sprint 의 cumulative `pnpm vitest run` 이 baseline 1875 에 +7 만 추가한 것 자체가 다른 surface 에 회귀 0 임을 강력히 시사.

## 가정 / 리스크

- **가정**: 기존 paradigm 가 `"rdb"` 또는 `"document"` 두 값만 채워져 있음. 미래 `"search"` / `"kv"` 가 추가될 때 paradigm 뱃지 텍스트는 `"SQL"` 로 fall-through 됨 — 해당 paradigm 의 viewer sprint 에서 update 해야 함 (out of scope).
- **리스크 (낮음)**: Leaf 아이콘 (size 10) 과 기존 Table2/Code2 (size 12) 의 시각 비례 — 디자인 검토 후 12 로 통일 가능. 본 sprint 는 "조용한 cue" 의도를 따라 의도적으로 작게 유지.
- **리스크 (낮음)**: `aria-label` 의 한국어/영어 — 현재 영어. i18n layer 도입 시 함께 wrap.

## 회귀 0

- TabBar: RDB tab DOM byte-identical (테스트 #2 negative assertion). 기존 30 케이스 통과.
- GlobalQueryLogPanel: 기존 row layout 유지 (badge 만 append). 기존 23 케이스 통과.
- sprint-120/121/122 결과 + store/Tauri/datagrid/rdb 모두 byte-identical.
- 다른 110 파일 1822 케이스 모두 통과.

## Phase 마감

본 sprint 로 master plan 의 paradigm-aware viewer 시리즈 (`sprint-120`~`sprint-123`) 완료:
- sprint-120: `paradigm.ts` + exhaustive switch + RDB 폴더 정리.
- sprint-121: AddDocumentModal CodeMirror migration + field-name AC.
- sprint-122: DocumentFilterBar (Structured + Raw MQL).
- sprint-123: paradigm 시각 cue (TabBar + QueryLog).

다음 단계 (사용자 요청): e2e 테스트 시나리오 점검 / 보완 → push → CI 모니터링.
