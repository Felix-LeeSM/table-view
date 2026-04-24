# Sprint Contract: sprint-85 (Paradigm-aware history viewer highlighting)

## Summary

- Goal: 저장된 쿼리를 미리 보여주는 모든 지점 — query tab 의 in-tab history row, global query log 의 collapsed row + expanded body — 이 entry 의 `paradigm` 필드에 따라 렌더러를 분기. `paradigm === "rdb"` 또는 legacy (paradigm 누락) 는 기존 `SqlSyntax` 토큰 하이라이팅, `paradigm === "document"` 는 JSON 토큰 + MQL operator 문자열에 구분 클래스 (`cm-mql-operator` 또는 동등) 를 부여한 새 `MongoSyntax` 렌더러.
- Audience: Postgres/MySQL/SQLite 사용자 + Mongo 사용자 (find/aggregate). history 를 훑어볼 때 paradigm 별 coloration 으로 즉시 구별.
- Owner: Generator agent (general-purpose).
- Verification Profile: `mixed`

## In Scope

- `src/lib/mongoTokenize.ts` (신규) — pure module. Input: JSON-ish 문자열. Output: `{kind: "string" | "number" | "boolean" | "null" | "punct" | "whitespace" | "operator" | "identifier", text: string}[]`. MQL operator detection 은 Sprint 83 의 `MONGO_ALL_OPERATORS` 재사용 (`@lib/mongoAutocomplete`). Invalid JSON 도 best-effort tokenize — throw 없이 fallback `{kind: "identifier"}`.
- `src/lib/mongoTokenize.test.ts` (신규) — happy path (find filter / aggregate pipeline) + operator 판정 + invalid JSON fallback.
- `src/components/shared/MongoSyntax.tsx` (신규) — `{sql, className}` props (SqlSyntax 와 동일 시그니처, `sql` 필드 이름 유지). 내부에서 `tokenizeMongo` 호출, operator token 에 `cm-mql-operator` class 부여 (Sprint 83 의 editor decoration 과 동일 class 로 시각 통일).
- `src/components/shared/MongoSyntax.test.tsx` (신규) — operator span class 단언, invalid JSON non-throw, 빈 입력 단언.
- `src/components/shared/QuerySyntax.tsx` (신규) — paradigm-dispatching wrapper. Props: `{sql, paradigm?: Paradigm, queryMode?: QueryMode, className?}`. `paradigm === "document"` → `<MongoSyntax>`, 그 외 (기본값 포함) → `<SqlSyntax>`. `paradigm` 누락 시 `"rdb"` 기본값 (legacy fallback).
- `src/components/shared/QuerySyntax.test.tsx` (신규) — rdb/document 분기, legacy undefined paradigm → rdb, queryMode 전달 (현재는 컴포넌트 내부에서 직접 사용하지 않지만 확장 대비).
- `src/components/query/QueryTab.tsx` — in-tab history row (현재 `<SqlSyntax sql={entry.sql} ... />`) 를 `<QuerySyntax sql={entry.sql} paradigm={entry.paradigm} queryMode={entry.queryMode} ... />` 로 교체.
- `src/components/query/QueryTab.test.tsx` — rdb 엔트리 row 에 SQL 토큰 class, document 엔트리 row 에 `cm-mql-operator` class 가 존재하는지 단언.
- `src/components/query/GlobalQueryLogPanel.tsx` — collapsed `<span>{entry.sql ...}</span>` 와 expanded `<pre>` 블록을 `<QuerySyntax>` 로 감싼다. truncate 는 wrapper 외부 or sql 문자열 slice 로 유지.
- `src/components/query/GlobalQueryLogPanel.test.tsx` — 3 shape (rdb / document / legacy undefined paradigm) 별 rendering 단언, expanded view 도 동일 wrapper 통과.

## Out of Scope

- `SqlSyntax.tsx` 의 기존 tokenization 로직은 변경 금지 — import 만 wrapper 가 추가.
- `QueryEditor.tsx` / `useSqlAutocomplete.ts` / `useMongoAutocomplete.ts` / `sqlDialect.ts` / `mongoAutocomplete.ts` — 전부 건드리지 않음 (wrapper 가 `MONGO_ALL_OPERATORS` 만 **읽어** 사용).
- `queryHistoryStore.ts` / `tabStore.ts` — Sprint 84 에서 이미 paradigm 필드를 저장/복원. 이 sprint 는 **소비 측**만 담당.
- `QueryLog.tsx` (작은 legacy panel) — master spec 상 명시 없음. 필요시 개선 가능하지만 이 sprint scope 에 포함 않음.
- `src-tauri/**` 전체.
- DataGrid / DocumentDataGrid / BsonTreeViewer / QuickLookPanel 등.

## Invariants

- `src-tauri/**` diff 0.
- `SqlSyntax.tsx` diff 0 (wrapper 가 기존 컴포넌트를 그대로 재사용).
- `src/lib/sqlTokenize.ts` 수정 금지.
- `src/lib/mongoAutocomplete.ts` 수정 금지 (read-only import 만 허용 — `MONGO_ALL_OPERATORS`).
- `src/stores/queryHistoryStore.ts`, `src/stores/tabStore.ts` 수정 금지 (Sprint 84 에서 확정).
- `QueryEditor.tsx`, `useSqlAutocomplete.ts`, `useMongoAutocomplete.ts`, `sqlDialect.ts` 수정 금지.
- `QueryTab.tsx` 의 실행/복원 로직 (Sprint 84 에서 추가된 `handleLoad`, `loadQueryIntoTab`, 5 addHistoryEntry 호출) 불변 — 오직 history row 의 렌더 JSX 만 교체.
- `GlobalQueryLogPanel.tsx` 의 필터링/검색/connection dropdown 로직 불변 — collapsed + expanded 의 sql 텍스트 렌더 부분만 wrapper 교체.
- React convention: 함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix.
- Legacy entry (paradigm undefined) → SqlSyntax 로 fallback, throw 없음.
- Invalid JSON 문자열 → MongoSyntax 가 render 시 throw 없이 raw text 또는 partial token 으로 처리.

## Acceptance Criteria

- `AC-01` — QueryTab in-tab history row 에 `paradigm === "rdb"` entry 가 seed 되었을 때 SqlSyntax 토큰 class (예: `text-syntax-keyword`) 가 DOM 에 존재. 테스트는 `getByText` 또는 container query 로 class 포함 단언.
- `AC-02` — QueryTab in-tab history row 에 `paradigm === "document"` entry (`"{\"$match\": {...}}"`) 가 seed 되었을 때 rendered DOM 에 `cm-mql-operator` class 가 포함된 span 이 존재 (`$match` 토큰).
- `AC-03` — GlobalQueryLogPanel 의 collapsed 행 이 paradigm 별로 같은 wrapper 를 통해 렌더. rdb entry → SqlSyntax, document entry → MongoSyntax, legacy (paradigm 없음) → SqlSyntax fallback. 3 가지 케이스 각각 테스트.
- `AC-04` — GlobalQueryLogPanel 의 expanded 행 (클릭 시 펼쳐지는 `<pre>`) 도 같은 wrapper 를 사용. document entry 를 expand 했을 때 `cm-mql-operator` class 가 expanded element 내부에 존재.
- `AC-05` — 기존 truncate (collapsed 시 80 char max) 는 paradigm 에 관계 없이 유지. 테스트가 긴 sql 을 seed 하고 collapsed 에서 `...` 가 있음을 단언.
- `AC-06` — `src/lib/mongoTokenize.ts` 가 invalid JSON 입력에도 throw 없이 token array 를 반환 (fallback `{kind: "identifier"}` 토큰 하나 또는 best-effort partial tokens).
- `AC-07` — `MongoSyntax` 컴포넌트가 operator 토큰을 `cm-mql-operator` class 로 래핑. RDB 전용 토큰 class (`text-syntax-keyword` 등) 는 document entry 렌더에 등장하지 않음.
- `AC-08` — `QuerySyntax` 가 legacy entry (`paradigm === undefined`) 에 대해 SqlSyntax 를 렌더. 테스트가 `paradigm={undefined as any}` 를 전달하고 rdb 렌더 class 포함 단언.
- `AC-09` — `QuerySyntax` store / editor 등에 쓰기 부작용 없음. 테스트가 `queryHistoryStore.getState().entries` 및 `tabStore.getState()` 의 identity 를 render 전/후로 비교.
- `AC-10` — `pnpm tsc --noEmit`, `pnpm lint` 0 에러 / 0 경고.
- `AC-11` — `git diff --stat HEAD -- src-tauri/` empty + forbidden paths diff 전부 0.
- `AC-12` — 최소 10 개 신규 테스트. 전체 vitest regression 0 (Sprint 84 baseline 1525 유지 또는 증가).

## Design Bar / Quality Bar

- `mongoTokenize.ts` 는 React 비의존 pure module. `tokenizeMongo(src: string): MongoToken[]`. 설계 목표는 "JSON 을 느슨하게 파싱 + string 자리의 `$`-접두 값은 `operator` 태그 부여" — 엄격한 JSON parser 아님. 큰 파일 (> 10k chars) 은 사실상 history panel 에서 truncate 된 조각만 받음 → 성능 상한 O(chars).
- `MONGO_ALL_OPERATORS` 는 Sprint 83 에서 export 됨. Operator 판정은 `Set` 조회.
- `MongoSyntax.tsx` 는 `SqlSyntax.tsx` 와 동일한 props 시그니처 (`{sql, className}`) 를 맞춰 wrapper 교체가 단순.
- `QuerySyntax.tsx` 는 wrapper 에 불과. 두 구체 컴포넌트를 이미 memoize 하고 있으므로 추가 memo 불필요. `paradigm === "document"` 분기 한 줄 if 면 충분.
- Token CSS class: sql 은 기존 Tailwind-based `text-syntax-*`, mongo 도 동일한 semantic class 를 재사용 (`text-syntax-keyword`, `text-syntax-string`, `text-syntax-number`) + operator 토큰에 `cm-mql-operator` (Sprint 83 editor decoration 과 통일). 색상 개선은 후속 sprint.
- Truncate 는 wrapper 가 아닌 caller (QueryTab / GlobalQueryLogPanel) 가 이미 하는 대로 유지. `sql` 을 pre-slice 후 wrapper 에 전달.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 에러 0.
2. `pnpm lint` — 경고/에러 0.
3. `pnpm vitest run src/lib/mongoTokenize.test.ts src/components/shared/MongoSyntax.test.tsx src/components/shared/QuerySyntax.test.tsx src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` — 타겟 테스트 전부 pass.
4. `pnpm vitest run` — 전체 suite 회귀 없음 (Sprint 84 baseline 1525).
5. `git diff --stat HEAD -- src-tauri/` 빈 출력.
6. `git diff --stat HEAD -- src/components/shared/SqlSyntax.tsx src/lib/sqlTokenize.ts src/lib/mongoAutocomplete.ts src/stores/queryHistoryStore.ts src/stores/tabStore.ts src/components/query/QueryEditor.tsx src/components/query/QueryEditor.test.tsx src/hooks/useSqlAutocomplete.ts src/hooks/useMongoAutocomplete.ts src/lib/sqlDialect.ts src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx` 빈 출력.

### Required Evidence

- 변경/추가 파일 목록 + 각 파일 역할.
- `MongoSyntax` 의 operator class 적용 file:line.
- `QuerySyntax` 의 paradigm 분기 file:line.
- QueryTab history row 의 wrapper 교체 file:line.
- GlobalQueryLogPanel 의 collapsed + expanded wrapper 교체 file:line.
- AC-01 ~ AC-12 → 테스트 이름 또는 file:line 매핑.
- `git diff --stat HEAD -- src-tauri/` 및 forbidden-path 빈 출력 증명.

## Test Requirements

### Unit Tests (필수)
- AC-01 ~ AC-08 각각 최소 1 개 테스트.
- 에러/예외: invalid JSON body, 빈 sql, paradigm undefined.

### Coverage Target
- 전체: 라인 40%, 함수 40%, 브랜치 35%.
- 신규/수정 코드: 라인 70% 이상 권장.

### Scenario Tests (필수)
- [ ] Happy path — QueryTab rdb row → SQL 토큰 class 노출.
- [ ] Happy path — QueryTab document row → `cm-mql-operator` class 노출.
- [ ] Happy path — GlobalQueryLogPanel collapsed / expanded 양쪽 wrapper 통과.
- [ ] 에러/예외 — invalid JSON document entry 렌더 시 throw 없음.
- [ ] 경계 조건 — paradigm undefined (legacy) → SQL fallback.
- [ ] 기존 기능 회귀 없음 — SqlSyntax 자체 테스트 + Sprint 82/83/84 baseline 전부 pass.

## Test Script / Repro Script

1. `pnpm install` (lock 변경 시) → `pnpm tsc --noEmit && pnpm lint`.
2. `pnpm vitest run` — 전체 pass.
3. 수동 스모크 (optional): `pnpm tauri dev` → RDB 쿼리 탭 실행 → history row 가 SQL coloration. Mongo find 탭 실행 → history row 가 MQL coloration (`$match` 강조). Global Query Log 열기 → 두 종류 혼재된 entry 가 각기 적절히 렌더되는지 확인. 긴 entry click → expanded 영역도 동일 class.

## Ownership

- Generator: general-purpose agent (single pass).
- Write scope:
  - `src/lib/mongoTokenize.ts` (신규) + `.test.ts`
  - `src/components/shared/MongoSyntax.tsx` (신규) + `.test.tsx`
  - `src/components/shared/QuerySyntax.tsx` (신규) + `.test.tsx`
  - `src/components/query/QueryTab.tsx` (history row 한 곳)
  - `src/components/query/QueryTab.test.tsx`
  - `src/components/query/GlobalQueryLogPanel.tsx` (collapsed + expanded 2 곳)
  - `src/components/query/GlobalQueryLogPanel.test.tsx`
- Merge order: Sprint 84 이후.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
