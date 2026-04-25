# Sprint 120 → next Handoff

## Sprint 120 Result

- **PASS** (1 attempt) — 1847/1847 tests, tsc 0, lint 0. 1845 → 1847 (+2: paradigm.test.ts).

## 산출물

- **RENAMED** (git mv, content byte-identical 또는 import 라인만 변경):
  - `src/components/DataGrid.tsx` → `src/components/rdb/DataGrid.tsx` (import 1 line 갱신)
  - `src/components/DataGrid.test.tsx` → `src/components/rdb/DataGrid.test.tsx` (byte-identical)
  - `src/components/FilterBar.tsx` → `src/components/rdb/FilterBar.tsx` (byte-identical)
  - `src/components/FilterBar.test.tsx` → `src/components/rdb/FilterBar.test.tsx` (byte-identical)
  - `src/components/DocumentDataGrid.tsx` → `src/components/document/DocumentDataGrid.tsx` (byte-identical)
  - `src/components/DocumentDataGrid.test.tsx` → `src/components/document/DocumentDataGrid.test.tsx` (byte-identical)
  - `src/components/DocumentDataGrid.pagination.test.tsx` → `src/components/document/DocumentDataGrid.pagination.test.tsx` (byte-identical, 함께 이동)

- **NEW** `src/lib/paradigm.ts`:
  - Re-exports `Paradigm` type from `@/types/connection`.
  - Exports `assertNever(value: never): never` — exhaustiveness guard. Throws at runtime; the value of the guard is the *compile-time* contradiction it raises in callers when a new `Paradigm` variant is added.

- **NEW** `src/lib/paradigm.test.ts` — 2 cases:
  - runtime throw on unknown value (`"kafka" as never`).
  - error message includes the unexpected value (`"graph" as never`).

- **MODIFIED** `src/components/layout/MainArea.tsx`:
  - import 경로 갱신: `@components/DataGrid` → `@components/rdb/DataGrid`, `@components/DocumentDataGrid` → `@components/document/DocumentDataGrid`.
  - 신규 import: `import { assertNever, type Paradigm } from "@/lib/paradigm";`.
  - `TableTabView`: `if (isDocument) {...}` 분기 → `switch (paradigm) { case "document"; case "rdb"|"search"|"kv"; default: return assertNever(paradigm); }` 로 재구조화. JSX 내용은 보존; switch wrapper 만 추가.

- **MODIFIED** `src/components/rdb/DataGrid.tsx` — `import FilterBar from "@components/FilterBar"` → `"@components/rdb/FilterBar"`.

- **MODIFIED** `src/components/layout/MainArea.test.tsx` — `vi.mock("@components/DataGrid", ...)` → `vi.mock("@components/rdb/DataGrid", ...)` (mock 경로가 새 import 경로를 가리켜야 mock 이 실제로 적용됨).

- `docs/sprints/sprint-120/{contract.md, execution-brief.md, handoff.md}`.

## AC Coverage

- AC-01 ✅ — 모든 import 가 새 경로로 갱신, `pnpm tsc --noEmit` exit 0. 검증 명령: `grep -rn -E 'from "(@components|@/components)/(DataGrid|FilterBar|DocumentDataGrid)["/]' src/` 0 매치.
- AC-02 ✅ — `pnpm lint` exit 0; `pnpm vitest run` 1847/1847 (1845 baseline + 2 paradigm.test.ts).
- AC-03 ✅ — `git diff -M --stat HEAD` 결과:
  - 6 rename 파일이 `R` 마크. content diff 는 다음만:
    - `rdb/DataGrid.tsx`: 1 line (FilterBar import 경로) +1/-1.
    - 나머지 5 파일 (FilterBar pair, DocumentDataGrid trio): 0 line content diff (rename only).
- AC-04 ✅ — `src/lib/paradigm.ts:12` `export function assertNever(value: never): never`. `src/components/layout/MainArea.tsx:131` `default: return assertNever(paradigm);` (TableTabView 의 paradigm switch 끝).
- AC-05 ✅ — `git diff --stat HEAD -- src-tauri/` 빈 출력 (Tauri byte-identical).
- AC-06 ✅ — `git diff --stat HEAD -- src/components/datagrid/useDataGridEdit.ts` 빈 출력 (Sprint 86 결정 보존).
- AC-07 ✅ — 동적 import / `lazy()` 형태 0건 (grep 결과 없음). 정적 import 만 갱신.

## 검증 명령 결과

- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm vitest run src/lib/paradigm.test.ts` → 2/2 pass.
- `pnpm vitest run src/components/layout/MainArea.test.tsx` → 29/29 pass.
- `pnpm vitest run` → 110 files / **1847/1847** pass.
- `git diff -M --stat HEAD` → 6 rename 검출, content diff 는 import 라인 + MainArea switch 리팩터뿐.
- `grep -rn -E 'from "(@components|@/components)/(DataGrid|FilterBar|DocumentDataGrid)["/]' src/` → 0 매치.

## 구현 노트

- **Mock 경로**: `MainArea.test.tsx` 의 `vi.mock("@components/DataGrid", ...)` 가 1845/1847 → 1847/1847 로 가는 결정적 한 줄. mock 은 *import specifier 문자열* 을 가로채므로 component 가 이동하면 mock specifier 도 따라가야 한다.
- **switch wrapper 의 의도**: 미래 paradigm (예: `"graph"`) 가 `Paradigm` union 에 추가되면, switch 는 `paradigm` 을 `never` 로 좁히는 데 실패하고 `assertNever` 인자에서 컴파일 에러를 던진다. *동일한 가드를 다른 paradigm-fork 지점* (`QueryTab.tsx`, `QueryEditor.tsx` 등) 에도 점진 도입 가능 — 본 sprint 는 `MainArea.TableTabView` 1 곳에 한정.
- **JSX 보존**: switch 의 `case "document"` block 안 JSX 와 `case "rdb"|"search"|"kv"` block 안 JSX 는 기존 코드와 byte-identical (들여쓰기 한 단계 추가만). 즉 외부 동작 0 변경.
- **rdb fallback for `tab.paradigm === undefined`**: `TableTab.paradigm` 은 `Paradigm | undefined` (`tabStore.ts:48`) 이므로 `paradigm = tab.paradigm ?? "rdb"` 로 default 처리. sprint 84 의 paradigm-aware restore (legacy tab 도 paradigm 을 덧씌워 복원) 와 일치.
- **rename 파일 함께 이동**: 사용자가 누락하기 쉬운 점 — `DocumentDataGrid.pagination.test.tsx` 는 contract 에 명시되지 않았으나 `./DocumentDataGrid` 로부터 상대 import 하므로 함께 이동해야 했다. 7 파일 모두 한 번에 git mv.

## 가정 / 리스크

- 가정: `Paradigm` type 의 미래 확장은 `src/types/connection.ts` 한 곳에서만 일어남. paradigm 가드를 로컬에 복제하면 (sprint 121+) 이 가정은 자연스럽게 강화됨.
- 리스크 (낮음): `tab.paradigm` 이 `null` 또는 `Paradigm` 외 값으로 들어오는 경우 — `?? "rdb"` 가 `undefined` 만 처리. backend 가 `Paradigm` enum 강제 (Sprint 65) 하므로 실제로 발생 불가.
- 리스크 (낮음): switch 의 `case "search"`, `case "kv"` 가 RDB UI 로 fallthrough — 본 sprint 는 placeholder UI 를 만들지 않음 (out-of-scope). 현재 connectionStore 가 `search`/`kv` paradigm connection 을 만들지 않으므로 *논리적 unreachable*. 추후 paradigm 추가 시 명시적 분기 + UI 가 필요.

## 회귀 0

- DataGrid 테스트 (RDB) 무회귀.
- FilterBar 테스트 무회귀.
- DocumentDataGrid 테스트 (Mongo) 무회귀.
- MainArea 테스트 29/29 무회귀 (mock 경로 1 라인 갱신만).
- 1845 baseline → 1847 (+2 paradigm.test.ts) 모두 PASS.
- src-tauri/ 0 변경, useDataGridEdit.ts 0 변경.

## 다음 sprint

- Sprint 121: AddDocumentModal v2 (#PAR-3) — 새 `src/components/document/` 폴더 위에서 작업.
- Sprint 122: DocumentFilterBar (#PAR-4).
- Sprint 123: paradigm 시각 cue (#PAR-5).
- 후속 점진적 확산: `assertNever` 가드를 `QueryTab.tsx`, `QueryEditor.tsx`, `SchemaPanel.tsx` 의 paradigm 분기에도 도입 (각 sprint 의 부산물로 자연스럽게).
