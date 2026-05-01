# Sprint 185 — Findings

Sprint: `sprint-185` (Phase 23 / TablePlus 패리티 #4 — Safe Mode MVP).
Date: 2026-05-01.

## 1. analyzer 설계 결정

`src/lib/sqlSafety.ts` 는 **regex 기반 분류기** 다. 토큰화기 / state
machine / parser 를 자처하지 않는다. 본 sprint 가 cover 하는 분류 (DELETE
WHERE 부재, UPDATE WHERE 부재, DROP TABLE/DATABASE/SCHEMA, TRUNCATE) 는
모두 statement 의 *anchored prefix* + *키워드 boundary* 로 충분히
판별된다.

설계 원칙:

- **pure / sync / no-throw**: 잘못된 SQL 도 graceful 하게 `kind: "other"`
  + `severity: "safe"` 로 떨어진다. parser 에러로 commit pipeline 을
  중단하지 않는다.
- **case-insensitive**: 입력을 `toUpperCase()` 후 anchored regex 로 분류.
  대소문자 혼용 SQL (예: `delete From t`) 도 동일 결과.
- **comment stripping**: `--` line comment 와 `/* */` block comment 는
  `analyzeStatement` 진입 직후 제거. 사용자가 commented-out WHERE 으로
  가드를 우회할 수 없다.
- **subquery WHERE 인정**: `DELETE FROM t WHERE id IN (SELECT id FROM u
  WHERE flag)` 같은 케이스는 외부 WHERE 토큰이 *존재* 하므로 safe. 본
  sprint 는 외부 WHERE 의 *의미* (zero-filter 여부) 까지 검사하지 않는다
  — 그건 SQL parser 영역.

분류 규칙은 분기 5 개로 끝난다 (DELETE / UPDATE / DROP table-like /
TRUNCATE / 그 외). DDL 의 `ALTER` / `CREATE` 는 명시적으로 `ddl-other`
+ safe 로 분류 — Safe Mode 가 ALTER/CREATE 를 "위험" 으로 간주하지 않음
(table 을 추가하는 행위는 데이터 손실로 직결되지 않으므로). DROP INDEX
같은 비-table-DROP 도 `ddl-other` 로 떨어져 safe.

## 2. strict / off 2-mode 결정 (warn 모드 보류)

Phase 23 spec 은 strict / warn / safe 3 모드를 제안한다. 본 sprint 는
strict / off 2 모드만 도입한다.

**이유**:
- warn 모드는 *추가 confirm 다이얼로그* 를 요구한다. 그 다이얼로그 자체가
  새 component 1 개 분량 (focus trap, escape behavior, "Type DROP TABLE
  to confirm" 입력 검증, accessibility wiring). 본 sprint 의 scope 통제
  목적상 별 sprint.
- strict / off 만으로도 production 사고의 80% 시나리오 (raw editor 에서
  실수로 `DELETE FROM users` 입력 후 Cmd+S) 를 차단한다.
- warn 모드는 *그 사고가 발생한 후* 사용자가 의도적으로 진행하는 경로 —
  본 sprint 는 의도하지 않은 행동만 막는다.

**Trade-off**: 전문 사용자가 production 에서 의도된 WHERE-less DELETE 를
실행하려면 (a) 토글 off → (b) Execute → (c) 토글 on 의 3 step 이
필요하다. Phase 23 의 후속 sprint 가 warn 모드 + DDL typing confirm 으로
이 경로를 1 step (typing override) 으로 단축할 예정.

## 3. Out of Scope warn 모드 외 항목 결정

- **DDL typing confirm** — production DROP TABLE 시 테이블명 재타이핑.
  warn 모드와 같은 sprint 로 묶인다 (다이얼로그 component 공유).
- **`SqlPreviewDialog` (structure surface) 색띠** — `ColumnsEditor`,
  `IndexesEditor`, `ConstraintsEditor` 가 사용하는 별 component. 동일
  패턴이지만 surface 가 더 많아 별 sprint. 색띠 helper 추출은 그 시점에
  자연스럽게 이뤄진다 (call site 3 곳).
- **Mongo dangerous-op 분류** — Mongo 의 `db.collection.drop()` 또는
  `deleteMany({})` 같은 위험 op 는 SQL string 이 아니다. MQL 분석기는
  별 sprint (Mongo 분기의 commit pipeline 도 본 sprint 에서 무수정).
- **`safety_level` 새 필드** — Phase 23 spec 의 ConnectionConfig
  `safety_level` 필드는 도입하지 않음. 사용자가 production 외 환경에서
  도 strict 가드를 원할 때 별 sprint 가 safety_level override 도입.
  본 sprint 는 environment 만으로 충분.
- **multi-statement parsing** — `analyzeStatement` 는 *단일* statement
  만 받는다. Caller (commit pipeline) 가 이미 statement 별 분리. 사용자가
  raw editor 에서 `DELETE FROM x; DELETE FROM y;` 한 줄 입력 경로는 별
  sprint (multi-statement splitter 필요).
- **subquery 분석 정밀화** — `WHERE 1=1` 같은 의미상 zero-filter 는
  검출하지 않음. 별 sprint.

## 4. cross-window sync 패턴

`safeModeStore` 는 Sprint 152 의 `attachZustandIpcBridge` 를 사용한다.
다른 store (themeStore / connectionStore / mruStore / favoritesStore)
와 동일한 옵트인 패턴.

- `channel: "safe-mode-sync"` — 충돌 회피 위해 unique 채널.
- `syncKeys: ["mode"]` — function (`setMode`, `toggle`) 은 broadcast
  대상 아님. SYNCED_KEYS 가 정확히 `["mode"]` 임을 단위 테스트
  (`AC-185-02e`) 로 핀.
- `originId: getCurrentWindowLabel() ?? "unknown"` — 자기-echo 차단.

`bridge.catch()` 는 best-effort: bridge attach 가 실패해도 store 자체는
single-window 로 동작한다 (mruStore 와 동일 trade-off).

## 5. block message 표준 문구

정확히:

```
Safe Mode blocked: <첫 reason> (toggle Safe Mode off in toolbar to override)
```

- `<reason>` 은 `analyzeStatement` 의 `reasons[0]`. 예: `"DELETE without
  WHERE clause"`, `"DROP TABLE"`, `"TRUNCATE"`.
- 두 게이트 (`useDataGridEdit.handleExecuteCommit`,
  `EditableQueryResultGrid.handleExecute`) 가 같은 문구를 사용. 회귀
  테스트가 정규식 `/Safe Mode blocked: .* DELETE without WHERE/` 로 핀.
- 토스트 (`toast.error`) + 상태 (`commitError.message` /
  `executeError`) 두 surface 에 동일 문구.

문구 변경 시 양쪽 surface + 4 개 시나리오 테스트를 함께 갱신해야 한다.

## 6. AC → 테스트 매핑

| AC | 검증 위치 | 형태 |
|----|-----------|------|
| AC-185-01a~l | `src/lib/sqlSafety.test.ts` | Vitest unit |
| AC-185-02a~e | `src/stores/safeModeStore.test.ts` | Vitest unit |
| AC-185-03a~c | `src/components/workspace/SafeModeToggle.test.tsx` | Vitest component |
| AC-185-04a~d | `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` | Vitest hook |
| AC-185-05a~d | `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` | Vitest component |
| AC-185-06 (DataGrid) | `src/components/rdb/DataGrid.test.tsx` `[AC-185-06]` | Vitest component |
| AC-185-06 (EditableQueryResultGrid) | `src/components/query/EditableQueryResultGrid.test.tsx` `[AC-185-06]` | Vitest component |
| AC-185-07 | static greps + `git diff src-tauri/` + `git diff src/types/connection.ts` | static |

총 신규/추가 테스트: 12 (analyzer) + 5 (store) + 3 (toggle) + 4 (hook
gate) + 4 (grid gate) + 2 (색띠) = **30 cases**.

## 7. Evidence index

- Vitest 신규 5 파일:
  - `pnpm vitest run src/lib/sqlSafety.test.ts` → **14 passed** (12 contract
    cases + 2 추가: empty SQL + ALTER/CREATE).
  - `pnpm vitest run src/stores/safeModeStore.test.ts` → **5 passed**.
  - `pnpm vitest run src/components/workspace/SafeModeToggle.test.tsx` →
    **3 passed**.
  - `pnpm vitest run src/components/datagrid/useDataGridEdit.safe-mode.test.ts`
    → **4 passed**.
  - `pnpm vitest run src/components/query/EditableQueryResultGrid.safe-mode.test.tsx`
    → **4 passed**.
- Vitest 전체: `pnpm vitest run` → **176 files, 2578 tests passed**.
- TypeScript: `pnpm tsc --noEmit` → exit 0.
- ESLint: `pnpm lint` → exit 0.
- Cargo test: `cd src-tauri && cargo test --lib` → **326 passed; 0 failed;
  2 ignored**.
- Cargo clippy: `cargo clippy --all-targets --all-features -- -D warnings`
  → no warnings.
- Cargo fmt: `cargo fmt --check` → no diff.

Static greps:
- `grep -RnE 'it\.(skip|todo)|xit\(' src/lib/sqlSafety.test.ts ...` →
  0 matches.
- `git diff src-tauri/` → empty.
- `git diff src/types/connection.ts` → empty.

## 8. Assumptions

- `EnvironmentTag` 의 5 값 (`local | testing | development | staging |
  production`) 은 `ConnectionConfig.environment` string 과 일치. 다른
  값이 들어오면 색띠는 무색으로 fallback (`environment in ENVIRONMENT_META`
  guard).
- `useConnectionStore.connections` 의 entry 는 항상 zustand-persisted —
  즉 connection edit dialog 가 environment 를 set 하면 본 sprint 의 가드도
  같이 작동.
- `attachZustandIpcBridge` 의 best-effort attach 실패는 single-window
  실행에서 정상 (bridge 가 launcher window 가 없으면 reject 함).
- `buildRawEditSql` 은 PK-bounded WHERE 만 emit — 정상 경로에서 본
  sprint 의 가드는 발화하지 않음. 회귀 가드 의도.

## 9. Residual risk

- **CI runner cross-window race** — bridge attach 실패는 단위 테스트가
  catch 하지만, e2e (Sprint 175 까지의 docker harness) 에서 본 sprint 의
  토글이 두 window 간 sync 되는지는 본 sprint 가 별도로 검증하지 않음.
  사람-검증 (browser smoke) 항목.
- **Mongo dangerous-op 부재** — Mongo `deleteMany({})` 는 본 sprint 의
  가드가 cover 하지 않음. 별 sprint.
- **subquery 의 zero-filter** — `WHERE 1=1` 처럼 의미상 모든 row 매치
  되는 WHERE 는 본 sprint 가 safe 로 분류. parser 도입 전까지는 별
  sprint.
- **structure SqlPreviewDialog 색띠 부재** — `ColumnsEditor` /
  `IndexesEditor` / `ConstraintsEditor` 의 commit dialog 는 본 sprint 가
  cover 하지 않음. 별 sprint.

## 10. Phase 23 진행 상태

본 sprint 는 Phase 23 의 첫 sprint (MVP). 후속 sprint:
- **Sprint 186** (추정): warn mode + DDL typing confirm.
- **Sprint 187** (추정): structure surface 색띠 (3 개 editor).
- **Sprint 188** (추정): Mongo dangerous-op 분류 + Mongo paradigm 게이트.

Phase 23 종료는 위 3 sprint 완료 시점.
