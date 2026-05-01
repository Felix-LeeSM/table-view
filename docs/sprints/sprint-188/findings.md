# Sprint 188 — Findings

## 1. Phase 23 closure

Phase 23 (Safe Mode / TablePlus parity) 가 Sprint 188 으로 종료. 이로써
RDB (DataGrid edit, EditableQueryResultGrid, ColumnsEditor, IndexesEditor,
ConstraintsEditor) **및** Document paradigm (Mongo aggregate) 양쪽 모두에
production-scoped strict / warn / off 게이트가 활성화되었다.

## 2. Mongo write surface — Sprint 187 가정 정정

Sprint 187 findings §10 은 후속 작업으로 `db.collection.drop()`,
`deleteMany({})` 의 분류·게이트를 명시했지만, 이번 sprint 의 정찰
(`src-tauri/src/commands/document/`) 결과 **두 명령은 backend·frontend
어느 쪽에도 노출되지 않음** 을 확인했다.

현재 frontend 가 도달 가능한 Mongo write surface 는 다음 4개 뿐:

| 명령 | 위험도 | 비고 |
|------|--------|------|
| `insert_document` (단건) | 무해 | id 1건 |
| `update_document` (`_id` 기반 단건) | 낮음 | id 1건 |
| `delete_document` (`_id` 기반 단건) | 낮음 | id 1건 |
| `aggregate_documents` (pipeline) | **높음** | `$out` / `$merge` 가 collection-level destructive |

따라서 Sprint 188 의 게이트는 **`aggregate_documents` 의 `$out` /
`$merge`** 한 길로 좁혔다. 단건 mutate 는 RDB row delete 와 동등 분류로
현재 미게이트 (별도 정책 결정 필요).

## 3. helper hook 추출 — `useSafeModeGate`

Sprint 187 finding §10 가 명시한 hook 추출이 Sprint 188 에서 일어났다.
하지만 inflection 은 *4 사이트 → 5 사이트* 가 아니라 정확히는:

- 기존: 4 RDB 사이트 (DataGrid edit, EditableQueryResultGrid,
  ColumnsEditor, ConstraintsEditor) 가 inline 게이트.
- 신규: 1 Mongo 사이트 (QueryTab aggregate) 가 hook consume.

즉 hook 의 **첫 사용 사이트**가 Mongo. 기존 4 사이트의 마이그레이션은
별도 sprint 로 분리됐다 (회귀 위험 격리 — 각 사이트가
`ConfirmDangerousDialog` state 를 다르게 관리한다).

## 4. paradigm-agnostic 으로 정렬한 분석 shape

`StatementAnalysis`, `Severity`, `StatementKind` 가 SQL 전용 union 이었던
것을 `mongo-out` / `mongo-merge` / `mongo-other` 까지 확장. 이로써
`useSafeModeGate.decide(analysis)` 가 SQL / Mongo 어느 쪽에서 분석된
결과든 동일한 decision matrix 를 적용한다. paradigm 분기는 hook 호출
지점이 아니라 **analyzer 선택 시점** (analyzeStatement vs
analyzeMongoPipeline) 에서 일어난다.

## 5. ConfirmDangerousDialog 의 paradigm 일반화

`sqlPreview` prop 명은 RDB call-site 회귀 방지를 위해 보존했지만 aria-
label 을 `"SQL preview"` → `"Statement preview"` 로 정정. Mongo
aggregate pipeline 의 JSON 도 같은 preview 슬롯에 들어가므로 표현이
SQL 로 한정되지 않게 되었다.

## 6. dispatch helper 추출 — `runMongoAggregateNow`

Mongo aggregate 의 dispatch + queryState/history 후속 처리를 helper 로
분리. handleExecute 의 aggregate gate 통과 path 와 confirm dialog 의
"Run anyway" path 가 같은 helper 를 호출하도록 묶었다. 이 helper 의 deps
는 `tab` 전체 (여러 필드 reference) — useTabStore 가 매 변경에 새 객체를
emit 하므로 매 render 신규 콜백 생성과 동치. 다른 콜백들과 동일.

## 7. 단건 mutate 의 정책 미결

`insert_document` / `update_document` / `delete_document` 단건은 현재
게이트하지 않는다. 이유:

- RDB 의 row-level delete (`useDataGridEdit` 의 single-row commit) 도
  현재 미게이트.
- 단건 destructive 는 user intent 가 명백한 path 라 over-gating 이
  실제 안전을 늘리지 않으면서 click-noise 만 늘림.
- "delete 5 rows in a single bulk DataGrid commit" 같은 RDB 케이스도
  현재 단건 분기를 거치므로 정책 통일이 필요.

별도 결정 단위로 분리. (user feedback 추가 수집 후 별도 sprint 단위로
결정 — Phase 신설 안 함.)

## 8. 후속 Sprint 후보 — Mongo bulk-write 신규 명령

`deleteMany`, `updateMany`, `dropCollection` 같은 collection-level
destructive 는 Tauri command 신규 + UI 진입점 (sidebar context menu /
Quick Look 모드 / aggregate stage extension 중 택일) 이 필요하다.
`useSafeModeGate` 는 이미 paradigm 무관하게 동작하므로 신규 명령에는
인풋만 새 analyzer (`analyzeMongoOperation` 류) 가 추가된다. **Phase
신설 없이 Sprint 단위로 처리** (Phase 24 = Index Write UI 와 명명 충돌
회피) — `docs/refactoring-plan.md` 의 Sprint 197 (mongodb.rs split) +
Sprint 198 (bulk-write 3 신규 command) 으로 등재.

## 9. 검증

- vitest: 181 files / 2640 tests pass (+2 files, +22 tests).
  - `mongoSafety.test.ts` (10 cases — pipeline 분석 매트릭스).
  - `useSafeModeGate.test.ts` (6 cases — decision matrix + missing
    connection edge case).
  - `QueryTab.test.tsx` Sprint 188 describe (6 cases — strict block /
    warn confirm-then-run / warn cancel / off allow / non-prod allow /
    safe pipeline allow).
- tsc 0, lint 0.
- src-tauri/ 무변경.

## 10. 후속

`docs/refactoring-plan.md` 의 10단계 sequencing 으로 통합:

- **Sprint 189**: RDB 5 사이트 inline gate 를 `useSafeModeGate` 로
  마이그레이션 (Phase 23 closure refactor).
- **Sprint 190 (FB-1b)**: prod-auto SafeMode.
- **Sprint 191**: SchemaTree 분해 (refactor).
- **Sprint 192 (FB-3)**: DB 단위 export.
- **Sprint 193**: useDataGridEdit 분해 (refactor).
- **Sprint 194 (FB-4)**: Quick Look 편집.
- **Sprint 195**: tabStore intent actions (refactor).
- **Sprint 196 (FB-5b)**: query history source 필드.
- **Sprint 197**: mongodb.rs 4분할 (refactor).
- **Sprint 198**: Mongo bulk-write 3 신규 command (Phase 신설 없이
  Sprint 단위).
