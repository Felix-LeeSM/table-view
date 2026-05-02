# Sprint 196 — Contract

Sprint: `sprint-196` (FB-5b — query history `source` 필드 + 범위 확장).
Date: 2026-05-02.
Type: feature.

`docs/refactoring-plan.md` Sprint 196 row + PLAN.md FB-5b. Sprint 195 의
`recordHistory` wrapper 위에 `source: QueryHistorySource` 필드를 추가,
audit 결과 누락된 발사점 (grid-edit / ddl-structure / mongo-op) 을 일관
경로로 history 에 합류시킨다.

## Audit 결과 (Sprint 196 진입 시점)

| 발사점 | 현재 상태 | 분류 | sprint 196 액션 |
|--------|----------|------|-----------------|
| `QueryTab.handleExecute` (find / aggregate / SQL) | recorded (Sprint 195) | `raw` | source 인자 1 추가 |
| `useDataGridPreviewCommit.runRdbBatch` | not recorded | `grid-edit` | wire (success/실패) |
| `useDataGridPreviewCommit.handleExecuteCommit` (Mongo) | not recorded | `grid-edit` | wire (success/실패) |
| `EditableQueryResultGrid.handleCommit` (raw-edit) | not recorded | `grid-edit` | wire (success/실패) |
| `ColumnsEditor.runAlter` | not recorded | `ddl-structure` | wire |
| `IndexesEditor.runPendingExecute` (create + drop) | not recorded | `ddl-structure` | wire |
| `ConstraintsEditor.runPendingExecute` (add + drop) | not recorded | `ddl-structure` | wire |
| `SchemaTree.dropTable` (context menu) | not recorded | `ddl-structure` | wire |
| `DocumentDataGrid.handleAddSubmit` (insertDocument) | not recorded | `mongo-op` | wire |

## Sprint 안에서 끝낼 단위

- **Type plumbing**:
    - `QueryHistorySource` union 신설 — `"raw" | "grid-edit" |
      "ddl-structure" | "mongo-op"`.
    - `QueryHistoryEntry.source` required field. `addHistoryEntry`
      payload 의 `source?` (default `"raw"` for back-compat).
    - `tabStore.recordHistory` payload 에 `source?` 추가 (default `"raw"`).
- **Wiring** (audit 표의 9 발사점 — `raw` 1 곳 외 8 곳 신규):
    - 각 발사점에서 success / error / cancelled 분기마다 history 등재.
    - 실행 SQL/MQL 문자열 확보 가능한 곳은 그대로 사용. DDL helpers
      (`createIndex` / `addConstraint` 등) 는 preview-only 1 차 호출에서
      반환된 sql 을 history 에 사용.
- **UI**:
    - `QueryLog` / `GlobalQueryLogPanel` 의 row 에 `source` 배지 1 칸
      추가. raw 는 배지 미표시 (시각 노이즈 방지). 그 외 3 source 만
      배지 surface.
- **회귀 0**: 기존 vitest baseline (Sprint 195: 186 files / 2706 tests)
  + 신규 wiring 테스트만 가산.

## Acceptance Criteria

### AC-196-01 — `QueryHistorySource` union 도입

`queryHistoryStore` 의 entry 타입에 `source` 필드 추가.

- `QueryHistoryEntry.source: QueryHistorySource` (required).
- `addHistoryEntry` payload 의 `source?` 옵셔널, 미전달 시 store 가
  default `"raw"` 로 채움 (기존 callsite 무수정 호환).
- `filteredGlobalLog` / `normaliseEntry` 가 legacy entry 의 누락된
  `source` 를 `"raw"` 로 채움 (Sprint 84 paradigm/queryMode 패턴 그대로).

테스트: `src/stores/queryHistoryStore.test.ts` 신규 `[AC-196-01-1..3]`
— 명시적 source / 누락 default / legacy `set({entries:...})` normalise.

### AC-196-02 — `recordHistory` source 인자

`tabStore.recordHistory(tabId, payload)` payload 에 `source?:
QueryHistorySource` 추가.

- 미전달 시 default `"raw"`.
- 전달 시 그대로 history entry 의 `source` 로 전파.

테스트: `tabStore.test.ts` 신규 `[AC-196-02-1..2]` — default raw / 명시
mongo-op.

### AC-196-03 — grid-edit 발사점 wiring

다음 3 사이트가 history 에 `source: "grid-edit"` 로 entry 등재:

- `useDataGridPreviewCommit` RDB success / error → entry 1 개.
- `useDataGridPreviewCommit` Mongo success / error → entry 1 개.
- `EditableQueryResultGrid` raw-edit success / error → entry 1 개.

각 사이트는 commit SQL / MQL 문자열 (preview 시점 이미 합성된 것) 을
sql 필드로 사용. 다중 statement 인 경우 구분자 `;\n` 으로 join.

테스트: `[AC-196-03-1..3]` — 각 사이트 success path → globalLog 에
`source: "grid-edit"` entry 1 개 확인.

### AC-196-04 — ddl-structure 발사점 wiring

다음 사이트가 history 에 `source: "ddl-structure"` 로 entry 등재:

- `ColumnsEditor.runAlter` (alterTable).
- `IndexesEditor.runPendingExecute` (createIndex / dropIndex).
- `ConstraintsEditor.runPendingExecute` (addConstraint / dropConstraint).
- `SchemaTree.dropTable` (context menu).

각 사이트 success / error / 사용자 cancel (warn confirm 부정) 분기.

테스트: `[AC-196-04-1..4]` — 각 사이트 1 case (대표 시나리오 success).

### AC-196-05 — mongo-op 발사점 wiring

`DocumentDataGrid.handleAddSubmit` 의 `insertDocument` 가 history 에
`source: "mongo-op"` 로 entry 등재.

테스트: `[AC-196-05-1]` — Add Document submit 후 globalLog 에 entry
1 개.

### AC-196-06 — UI source 배지

`QueryLog` / `GlobalQueryLogPanel` row 에 `source` 배지 surface:

- `raw` → 배지 미표시 (visual quiet).
- `grid-edit` / `ddl-structure` / `mongo-op` → 작은 배지 (텍스트 + 색깔
  구분).
- 배지는 `aria-label` 로 source 명 노출.

테스트: `GlobalQueryLogPanel.test.tsx` 신규 `[AC-196-06-1..2]` — raw
미표시 / grid-edit 배지 surface.

## Out of scope

- raw history 의 statement-level breakdown (multi-stmt 의 per-stmt
  source 분기) — 향후 sprint 재평가.
- history filter UI 에 source-by-source 필터 — V1 은 search /
  connectionFilter 만. source filter 는 별 sprint.
- 이미 시스템적으로 일어나는 schema fetch / preview-only DDL 호출 —
  사용자 의도 기반 발사 아님이라 history 에서 제외.
- Mongo dangerous-op confirm 별도 entry — 이미 QueryTab `raw` 로 1 회
  recorded.

## 검증 명령

```sh
pnpm vitest run src/stores/queryHistoryStore.test.ts \
  src/stores/tabStore.test.ts \
  src/components/query/GlobalQueryLogPanel.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모든 테스트 green. tsc 0 / lint 0. Rust 변경 없음.
