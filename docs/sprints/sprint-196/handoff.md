# Sprint 196 — Handoff

Sprint: `sprint-196` (FB-5b — query history `source` field + 발사점 확장).
Date: 2026-05-02.
Status: closed.
Type: feature (Sprint 195 토대 위에서 source taxonomy + UI badge 추가).

## 어디까지 했나

`QueryHistorySource` union 1 개 신설 + 9 발사점 audit 결과 누락된 8 곳
모두 history 에 합류. UI 는 `QueryHistorySourceBadge` 1 컴포넌트로
3 source (`grid-edit` / `ddl-structure` / `mongo-op`) 만 surface, `raw`
는 visual quiet 유지.

- **Type plumbing**: `QueryHistorySource` union, `QueryHistoryEntry.source?`
  optional 으로 add (legacy 호환), `addHistoryEntry` payload `source?`
  optional default `"raw"`, `normaliseEntry` / read path 가 누락된 source
  를 `"raw"` 로 채움.
- **Wiring**: 8 사이트 모두 selector 구독 (`const addHistoryEntry =
  useQueryHistoryStore((s) => s.addHistoryEntry);`) 패턴으로 통일 — B-2
  허용 범위 안이지만 기존 pattern (`QueryLog`, `GlobalQueryLogPanel`,
  `QueryTab`) 일관성 + B-6 cross-store hook level 룰을 따름.
- **UI**: `QueryHistorySourceBadge` 신규 1 컴포넌트, `QueryLog` /
  `GlobalQueryLogPanel` 양쪽 row 에 1 줄 삽입.

## Files changed

| 파일 | Purpose |
|------|---------|
| `src/stores/queryHistoryStore.ts` (+30 / -10) | `QueryHistorySource` union, entry 에 `source?` optional 추가, `AddHistoryEntryPayload` payload 확장, `normaliseEntry` / read path 가 missing source 를 `"raw"` 로 채움. |
| `src/stores/queryHistoryStore.test.ts` (+60 / 0) | `[AC-196-01-1..3]` 신규 3 case (explicit / default raw / legacy normalise). |
| `src/stores/tabStore.ts` (+5 / -1) | `recordHistory` payload 에 `source?: QueryHistorySource` 추가, default `"raw"`. `QueryHistorySource` import. |
| `src/stores/tabStore.test.ts` (+74 / 0) | `[AC-196-02-1..2]` 신규 2 case. |
| `src/hooks/useDataGridPreviewCommit.ts` (+50 / -2) | RDB success/error + Mongo success/error 4 callsite + selector + deps. |
| `src/components/query/EditableQueryResultGrid.tsx` (+30 / -1) | runBatch success/error 2 callsite + selector + deps. |
| `src/components/query/EditableQueryResultGrid.test.tsx` (+38 / 0) | `[AC-196-03-3]` 신규 1 case. |
| `src/components/structure/ColumnsEditor.tsx` (+25 / -1) | runAlter success/error 2 callsite + selector. |
| `src/components/structure/ColumnsEditor.test.tsx` (+44 / 0) | `[AC-196-04-1]` 신규 1 case. |
| `src/components/structure/IndexesEditor.tsx` (+25 / -1) | runPendingExecute success/error 2 callsite + selector. |
| `src/components/structure/ConstraintsEditor.tsx` (+27 / 0) | import 추가 + selector + runPendingExecute success/error 2 callsite. |
| `src/components/schema/SchemaTree.tsx` (+30 / -1) | handleDropTable success/error 2 callsite + selector + import. 합성 sql `DROP TABLE "schema"."table"`. |
| `src/components/document/DocumentDataGrid.tsx` (+30 / -1) | handleAddSubmit success/error 2 callsite + selector + import. 합성 sql `db.<col>.insertOne(<JSON>)`. |
| `src/components/document/DocumentDataGrid.test.tsx` (+45 / 0) | `[AC-196-05-1]` 신규 1 case. |
| `src/components/query/QueryLog.tsx` (+5 / -1) | source badge 1 줄 삽입. |
| `src/components/query/GlobalQueryLogPanel.tsx` (+5 / -1) | source badge 1 줄 삽입. |
| **NEW** `src/components/shared/QueryHistorySourceBadge.tsx` (+55) | source 별 색깔 / 라벨 / tooltip / `data-source` 속성. raw / undefined → null return. |
| **NEW** `src/components/shared/QueryHistorySourceBadge.test.tsx` (+45) | `[AC-196-06-1..2]` 신규 5 case. |
| **NEW** `docs/sprints/sprint-196/contract.md` | sprint contract. |
| **NEW** `docs/sprints/sprint-196/findings.md` | audit / decision / 트레이드오프. |
| **NEW** `docs/sprints/sprint-196/handoff.md` | 본 파일. |

총 코드 14 modified + 3 신설, docs 3 신설.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-196-01 | `pnpm vitest run src/stores/queryHistoryStore.test.ts` | `[AC-196-01-1..3]` 3 case pass. legacy normalise 가 `source: undefined` → `"raw"` 채움. |
| AC-196-02 | `pnpm vitest run src/stores/tabStore.test.ts` | `[AC-196-02-1..2]` default raw / explicit mongo-op 2 case pass. |
| AC-196-03 | `pnpm vitest run src/components/query/EditableQueryResultGrid.test.tsx` | `[AC-196-03-3]` raw-edit 성공 → globalLog 에 `source: "grid-edit"` entry 1. (RDB grid commit / Mongo grid commit 은 hook level wiring 으로 동일 path — 회귀 테스트 시 useDataGridPreviewCommit 내부 분기는 그대로 통과.) |
| AC-196-04 | `pnpm vitest run src/components/structure/ColumnsEditor.test.tsx` | `[AC-196-04-1]` runAlter 성공 → `source: "ddl-structure"` entry 1. Indexes / Constraints / SchemaTree 는 동일 패턴 적용. |
| AC-196-05 | `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx` | `[AC-196-05-1]` Add Document 성공 → `source: "mongo-op"` entry 1. paradigm/database/collection 함께 검증. |
| AC-196-06 | `pnpm vitest run src/components/shared/QueryHistorySourceBadge.test.tsx` | `[AC-196-06-1..2]` 5 case pass — raw/undefined null, grid-edit/ddl-structure/mongo-op 각각 GRID/DDL/MQL 라벨 + `data-source` + tooltip. |
| Sprint 196 전체 | 4-set | **187 files / 2719 tests passed** (Sprint 195 baseline 186/2706 → +1 file `QueryHistorySourceBadge.test.tsx`, +13 신규 case); tsc 0; lint 0; src-tauri/ empty. |

## Required checks (재현)

```sh
pnpm vitest run src/stores/queryHistoryStore.test.ts \
  src/stores/tabStore.test.ts \
  src/components/shared/QueryHistorySourceBadge.test.tsx \
  src/components/query/EditableQueryResultGrid.test.tsx \
  src/components/structure/ColumnsEditor.test.tsx \
  src/components/document/DocumentDataGrid.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
git diff --stat src-tauri/
```

기대값: 모두 zero error / 187 files / 2719 tests / src-tauri empty.

## 다음 sprint 가 알아야 할 것

### 진입점 / API

- `QueryHistorySource = "raw" | "grid-edit" | "ddl-structure" | "mongo-op"`
  union 이 store 와 component 양쪽에서 사용. 새 발사점이 생길 때
  `addHistoryEntry({...source: "<x>"})` 한 줄 추가만으로 합류.
- `tabStore.recordHistory(tabId, payload)` 의 payload 에 `source?` 가
  optional, default `"raw"`. tab 외 발사점은 직접 `addHistoryEntry`
  selector 호출 (cross-store 결합은 hook/component level 만 — B-6).
- UI badge 는 `<QueryHistorySourceBadge source={entry.source} />` 1 줄
  drop-in. 새 source 추가 시 `META` 객체에 `label / className / title`
  3 필드 추가.

### 회귀 가드

- `src/stores/queryHistoryStore.test.ts` — 64 case (61 회귀 + 3 신규).
- `src/stores/tabStore.test.ts` — 107 case (105 회귀 + 2 신규).
- `src/components/query/EditableQueryResultGrid.test.tsx` — `[AC-196-03-3]`
  포함 grid-edit smoke.
- `src/components/structure/ColumnsEditor.test.tsx` — `[AC-196-04-1]`
  포함 ddl-structure smoke.
- `src/components/document/DocumentDataGrid.test.tsx` — `[AC-196-05-1]`
  포함 mongo-op smoke.
- `src/components/shared/QueryHistorySourceBadge.test.tsx` — 5 case
  badge surface / suppression.

### 후속

- **Sprint 197 (FB-5c, plan에서 다음)** — refactoring-plan 의 다음 row.
- 별 sprint 후보 — source-by-source filter UI (현 구현은 globalLog
  filter 가 connectionId / search 만), statement-level source breakdown,
  Mongo dangerous-op 별도 entry. 모두 본 sprint OOS.

### 외부 도구 의존성

없음. Rust 변경 0. 추가 IPC 0. design token 1 종 (`text-3xs`) 활용 —
이미 `index.css` 정의 보유.

## 폐기된 surface

- 없음. 모두 additive: type union + optional field + 신규 selector
  callsite + 신규 component. 기존 callsite 는 모두 호환.

## 시퀀싱 메모

- Sprint 191 (SchemaTree decomposition) → Sprint 192 (DB export) →
  Sprint 193 (useDataGridEdit decomposition) → Sprint 194 (FB-4 Quick
  Look edit) → Sprint 195 (tabStore intent actions) → **Sprint 196**
  (FB-5b query history source field).
- 다음 — Sprint 197 (refactoring-plan 의 다음 row).

## Refs

- `docs/sprints/sprint-196/contract.md` — sprint contract.
- `docs/sprints/sprint-196/findings.md` — 결정 / 결과 / 트레이드오프.
- `docs/refactoring-plan.md` Sprint 196 row.
- `memory/conventions/refactoring/store-coupling/memory.md` — B-2 / B-6
  룰 (selector 구독 패턴 / cross-store hook level 룰 — 본 sprint 검토
  발견).
