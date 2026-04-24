# Sprint Execution Brief: sprint-85 (Paradigm-aware history viewer highlighting)

## Objective

- 신규 `src/lib/mongoTokenize.ts` 를 도입해 JSON 문자열을 토큰화, `$`-접두 문자열을 operator 로 태깅 (Sprint 83 의 `MONGO_ALL_OPERATORS` 재사용).
- 신규 `src/components/shared/MongoSyntax.tsx` 는 `{sql, className}` props 로 token 을 span 으로 렌더, operator 에 `cm-mql-operator` 클래스 부여.
- 신규 `src/components/shared/QuerySyntax.tsx` wrapper 가 `paradigm === "document"` 면 MongoSyntax, 그 외 (legacy 포함) 는 기존 SqlSyntax 를 delegate.
- `QueryTab.tsx` 의 in-tab history row `<SqlSyntax>` → `<QuerySyntax paradigm queryMode sql>` 로 교체.
- `GlobalQueryLogPanel.tsx` 의 collapsed 라인 및 expanded `<pre>` 를 `<QuerySyntax>` 로 감싼다. truncate 는 caller 측에서 유지 (wrapper 는 sql 문자열을 그대로 받음).
- Legacy entries (paradigm undefined) 는 SQL fallback.

## Task Why

- Sprint 84 가 entry 에 paradigm 메타데이터를 기록하기 시작했으니, 이제 읽는 쪽이 그 메타데이터를 반영해 coloration 을 분기해야 history 가 "실행된 그대로" 보인다. 그렇지 않으면 Mongo `{"$match": ...}` 를 SQL 하이라이터가 잘못 강조 (혹은 강조 안 됨) 해 사용자 인지 부하 증가.
- Sprint 82+83 이 편집 경험에서 구축한 provider 대칭을 history 뷰까지 연결해 feature 전체가 완결.
- Sprint 83 에서 만든 `cm-mql-operator` class 를 editor + history 모두가 공유하면 CSS theming 이 한 곳에서 끝남.

## Scope Boundary

**수정 허용 (WRITE)**:
- `src/lib/mongoTokenize.ts` (신규)
- `src/lib/mongoTokenize.test.ts` (신규)
- `src/components/shared/MongoSyntax.tsx` (신규)
- `src/components/shared/MongoSyntax.test.tsx` (신규)
- `src/components/shared/QuerySyntax.tsx` (신규)
- `src/components/shared/QuerySyntax.test.tsx` (신규)
- `src/components/query/QueryTab.tsx` — history row 렌더 한 군데
- `src/components/query/QueryTab.test.tsx` — 새 단언 2~3 개
- `src/components/query/GlobalQueryLogPanel.tsx` — collapsed + expanded 2 군데
- `src/components/query/GlobalQueryLogPanel.test.tsx` — 3 shape rendering 단언

**절대 수정 금지 (diff 0)**:
- `src-tauri/**` 전체.
- `src/components/shared/SqlSyntax.tsx` — import 만 허용, 코드 수정 금지.
- `src/lib/sqlTokenize.ts` — import 없음, 수정 금지.
- `src/lib/mongoAutocomplete.ts` — `MONGO_ALL_OPERATORS` read import 만.
- `src/stores/queryHistoryStore.ts`, `src/stores/tabStore.ts` — Sprint 84 확정.
- `src/components/query/QueryEditor.tsx`, `QueryEditor.test.tsx` — Sprint 82/83 확정.
- `src/hooks/useSqlAutocomplete.ts`, `src/hooks/useMongoAutocomplete.ts`, `src/lib/sqlDialect.ts`.
- `src/components/datagrid/**`, `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/shared/BsonTreeViewer.tsx`, `src/components/shared/QuickLookPanel.tsx`.

## Invariants

- `src-tauri/**` diff 0.
- `SqlSyntax.tsx` 코드 diff 0 (wrapper 가 재사용만).
- `sqlTokenize.ts` diff 0.
- `mongoAutocomplete.ts` diff 0 (read import 만).
- `queryHistoryStore.ts`, `tabStore.ts` diff 0.
- `QueryEditor.tsx`, `useSqlAutocomplete.ts`, `useMongoAutocomplete.ts`, `sqlDialect.ts` diff 0.
- `QueryTab.tsx` 의 execute / load / store subscription 로직 diff 0 — history row 의 JSX 한 곳만 교체.
- `GlobalQueryLogPanel.tsx` 의 filter / search / connection dropdown / clear / close 로직 diff 0 — sql text 렌더 2 곳만 교체.
- React convention: 함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix.
- `MongoSyntax` / `QuerySyntax` 는 side-effect free, store 에 쓰지 않음.
- `mongoTokenize` 는 invalid JSON 에도 throw 금지.

## Done Criteria

1. `src/lib/mongoTokenize.ts` 가 `{kind, text}[]` 를 반환하는 pure 함수 `tokenizeMongo(sql: string): MongoToken[]` 를 export. kind 는 `"string" | "number" | "boolean" | "null" | "punct" | "whitespace" | "operator" | "identifier"`.
2. `MONGO_ALL_OPERATORS` 집합을 참조해 문자열 토큰 중 `$`-접두 + 등록된 operator 인 경우 `"operator"` kind 로 태깅.
3. Invalid JSON 입력도 throw 없이 best-effort tokenize (fallback `{kind: "identifier"}`).
4. `src/components/shared/MongoSyntax.tsx` 가 `{sql: string, className?: string}` props 로 token 을 span 으로 렌더. operator 토큰에 `cm-mql-operator` class 포함.
5. `src/components/shared/QuerySyntax.tsx` 가 `{sql, paradigm?, queryMode?, className?}` props 로 paradigm 을 기준으로 MongoSyntax (`"document"`) 또는 SqlSyntax (그 외 및 undefined) 중 하나를 렌더.
6. `QueryTab.tsx` history row 의 sql 텍스트 렌더가 `<SqlSyntax>` → `<QuerySyntax>` 로 교체. paradigm + queryMode 를 entry 에서 전달.
7. `GlobalQueryLogPanel.tsx` 의 collapsed sql span 및 expanded `<pre>` 본문이 `<QuerySyntax>` 로 교체. 기존 truncate (80 char) 는 caller 가 유지.
8. Legacy entry (paradigm undefined) 는 SqlSyntax 로 fallback 되어 렌더 throw 없음.
9. 최소 10 개 신규 테스트. 각 AC 매핑.
10. `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` 전부 pass.
11. `git diff --stat HEAD -- src-tauri/` empty 및 forbidden-path 전부 diff 0.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run src/lib/mongoTokenize.test.ts src/components/shared/MongoSyntax.test.tsx src/components/shared/QuerySyntax.test.tsx src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx`
  4. `pnpm vitest run` — 전체 suite regression (baseline 1525)
  5. `git diff --stat HEAD -- src-tauri/` empty
  6. `git diff --stat HEAD -- src/components/shared/SqlSyntax.tsx src/lib/sqlTokenize.ts src/lib/mongoAutocomplete.ts src/stores/queryHistoryStore.ts src/stores/tabStore.ts src/components/query/QueryEditor.tsx src/components/query/QueryEditor.test.tsx src/hooks/useSqlAutocomplete.ts src/hooks/useMongoAutocomplete.ts src/lib/sqlDialect.ts src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx` empty

## Evidence To Return

- 변경/추가 파일 목록 + 각 파일 목적.
- `mongoTokenize.ts` 의 operator tagging 위치 file:line.
- `MongoSyntax.tsx` 의 class 주입 file:line.
- `QuerySyntax.tsx` 의 paradigm 분기 file:line.
- `QueryTab.tsx` history row wrapper 교체 file:line.
- `GlobalQueryLogPanel.tsx` collapsed + expanded wrapper 교체 file:line (2 곳).
- 각 AC-01 ~ AC-12 → 테스트 이름 또는 file:line 매핑.
- `git diff --stat HEAD -- src-tauri/` 및 forbidden-path 빈 출력 증명.
- Assumptions:
  - `MONGO_ALL_OPERATORS` 는 Sprint 83 에서 `src/lib/mongoAutocomplete.ts:128` 에 export. read-only import 로만 소비.
  - `cm-mql-operator` class 는 Sprint 83 editor decoration 과 동일 name — CSS 의 단일 entry 로 editor + history 에 동시 적용.
  - invalid JSON 입력 시 parser 는 best-effort, 실패 지점 이후는 raw text 로 포함 (identifier token 한 개로 묶기도 허용).
  - `truncateSql(sql, 80)` 은 wrapper 가 아닌 caller 에서 유지 — sql 이 80 char 초과 시 slice 된 문자열을 wrapper 에 넘김. JSON mid-truncation 이 발생하더라도 tokenize 가 throw 하지 않음을 AC-06 으로 보증.
  - QueryTab 의 editor identity + Sprint 84 의 restore 로직은 diff 0 — wrapper 는 render-only.
- Residual risk:
  - 긴 truncate 된 JSON (`...`) 끝에 `cm-mql-operator` class 가 소실되는 edge: caller 의 80 char slice 로 인해 operator 이름이 잘리면 operator 로 분류되지 않음. 허용된 degradation.
  - Hover / selection 의 truncate 토큰 class 불일치는 다음 sprint 의 UX 개선 대상.

## References

- Master spec: `docs/sprints/sprint-81/spec.md` (Sprint 85 섹션)
- Sprint 83 handoff: `docs/sprints/sprint-83/handoff.md` (operator class + MONGO_ALL_OPERATORS 재사용)
- Sprint 84 handoff: `docs/sprints/sprint-84/handoff.md` (entry.paradigm 메타데이터 소스)
- Relevant files (read-only, 참고용):
  - `src/components/shared/SqlSyntax.tsx` — 기존 tokenization + span 렌더 패턴
  - `src/lib/sqlTokenize.ts` — pure tokenizer API 의 레퍼런스 구현
  - `src/lib/mongoAutocomplete.ts` — `MONGO_ALL_OPERATORS` export 지점 (L128)
  - `src/stores/queryHistoryStore.ts` — `QueryHistoryEntry.paradigm` / `queryMode` 타입
  - `src/components/query/QueryTab.tsx` L792 (현재 `<SqlSyntax>` 위치)
  - `src/components/query/GlobalQueryLogPanel.tsx` L187 (collapsed), L217 (expanded `<pre>`)
