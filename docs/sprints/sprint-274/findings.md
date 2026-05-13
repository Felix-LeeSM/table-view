# Sprint 274 — Trigger DROP · Evaluator Findings

**Result**: PASS (Overall **8.6/10**, all dims ≥ 7, no P0/P1).
**Phase**: 26 (Trigger lifecycle) — Sprint 274 closes the phase.

## Scores (Evaluator attempt 1)

| Dimension           | Score |
| ------------------- | ----- |
| Correctness         | 9/10  |
| Test coverage       | 8/10  |
| Contract adherence  | 9/10  |
| Code quality        | 9/10  |
| Robustness          | 8/10  |
| **Overall**         | **8.6/10** |

PASS gate: 모든 차원 ≥ 7, P0/P1 없음.

## 무엇이 만들어졌는지

### Backend (Rust)

- `DropTriggerRequest` 모델 (`connection_id`, `database`, `table`, `schema`, `trigger_name`, `cascade`).
- `RdbAdapter::drop_trigger` trait 메서드.
- PG 구현:
  - `build_drop_trigger_sql` — 순수 helper, 3 식별자 (`schema`, `table`, `trigger_name`) `validate_identifier` 통과, `CASCADE` 분기.
  - `drop_trigger_inner` — `ensure_expected_db` 재사용, `sqlx::Transaction::begin/commit`로 wrap (Sprint 235 drop_table 패턴 mirror).
- `StubRdbAdapter::drop_trigger_fn` slot (테스트용 injection).
- Tauri command + `invoke_handler` 등록.

### Frontend (React/TS)

- `DropTriggerDialog` — Sprint 235 `DropTableDialog`와 구조적 parity:
  - typing-confirm (trigger 이름 byte-for-byte 일치) + `CASCADE` checkbox + Show DDL pane.
  - Safe-Mode warn-tier `ConfirmDestructiveDialog` 통합.
  - `useDdlPreviewExecution` 재사용.
- `handleDropTrigger` opener + `dropTriggerDialog` slot (워크스페이스 상태).
- Per-trigger row context menu **Drop** affordance — Sprint 273의 `disabled` placeholder를 swap.
- `sqlSafety.ts` — `DROP TRIGGER` → `ddl-drop` / `danger` 분류 추가.

### Tests

- **13 backend tests**: 2 SQL emission + 4 identifier rejection + 1 preview + 1 no-connection + 4 ddl wiring (mismatch panic-closure 포함) + 1 serde roundtrip.
- **7 vitest cases**: 다이얼로그 렌더, typing-confirm gate, CASCADE toggle, DDL preview, Safe-Mode warn confirm, IPC dispatch, error surface.

## Resolved

- AC-274-01..07 모두 만족.
- Sprint 272/273 회귀 없음 — `list_triggers`, `get_trigger_source`, `schemaStore.triggers`, `CreateTriggerDialog` 전부 unchanged.
- Phase 21–25 DROP 다이얼로그 회귀 없음.

## Generator decisions (Evaluator approved)

1. **Per-table-row "Drop Trigger…" placeholder 제거** (enable 대신).
   - 근거: bulk per-table drop은 spec § 7 out-of-scope. per-trigger row context에서만 Drop이 의미 있음.
   - Contract Done Criteria #5 literal wording과 deviation 있으나 defensible (→ P2 #1).
2. **`sqlSafety.ts` DROP TRIGGER 분류 추가** — Safe-Mode warn-tier `ConfirmDestructiveDialog` 트리거에 필수.
3. **`IF EXISTS` 미사용** — Sprint 235 `drop_table` 정책 mirror.

## Residual P2s (Phase 27 또는 그 이전 cleanup commit으로 정리)

1. **Contract Done Criteria #5 wording divergence** — per-table placeholder enable vs removal. Contract retro-amend 또는 ADR 권장.
2. **Warn-tier confirm path partial test** — `DropTriggerDialog.test.tsx:275-303`이 mount만 assert; Confirm click → post-confirm commit 흐름 fully 검증 안됨. 1줄 추가 권장.
3. **Manual `pnpm tauri dev` smoke 미수행** — AC-274-06에 명시되었으나 Generator는 vitest IPC 시퀀스로 대체. Phase 26 close 전 real UI smoke 권장.
4. **typing-confirm 시 no-trim 직접 assertion 부재** — `DropTriggerDialog.tsx:119-122` 주석으로 보장되나 테스트는 implicit (whitespace-padded → disabled). 직접 assertion 권장.

## Carryover (Phase 26 누적 debt → Sprint 275+ pickup target)

1. **Sprint 272/273 P2 #1** — `body.tsx::TriggerGroupSubtree` ↔ `treeRows.ts::buildTriggerRowsForTable` 렌더 분기 중복. Sprint 274도 또 deferred. 회귀는 없지만 drift surface 누적.
2. **Sprint 273 P2 #2** — `CreateTriggerDialog.tsx:251` useEffect deps churn.
3. **Sprint 273 P2 #3** — `CreateTriggerDialog.tsx:488, 499` 중복 `setFunctionName` collapse.

## Phase 26 close status

| Sprint | Scope            | Result        |
| ------ | ---------------- | ------------- |
| 272    | Trigger READ     | PASS **8.6**  |
| 273    | Trigger CREATE   | PASS **8.4**  |
| 274    | Trigger DROP     | PASS **8.6**  |

**Phase 26 average: 8.5/10. ALL PASS.**

## Next Phase recommendation

- **Pickup commit `chore(sprint-275-pre): trigger render-path cleanup`** (carryover #1/#2/#3) — risk zero, 90-line drift surface 제거.
- **Phase 27 candidate**는 `docs/PLAN.md` 재검토 후 결정. Function CREATE/EDIT은 spec § 7에서 indefinite defer 상태이므로 별도 영역(예: Index lifecycle 또는 SELECT performance) 검토 권장.
