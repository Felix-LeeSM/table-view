# Sprint 186 — Findings

Sprint: `sprint-186` (Phase 23 / TablePlus 패리티 #4 — Safe Mode warn 모드 + DDL typing confirm).
Date: 2026-05-01.

## 1. 3-way 순환 결정 (strict → warn → off → strict)

Sprint 185 의 strict / off 2-way 토글 위에 warn 을 *중간* 단계로 끼워넣었다.
`toggle()` 한 번이 strict → warn 으로만 진행하므로 사용자가 한 번
실수로 클릭해도 production 가드가 즉시 해제되지 않는다 (warn 단계가
type-to-confirm 다이얼로그로 게이트한다).

설계 원칙:

- **strict → warn → off**: warn 을 strict-옆이 아닌 *strict 와 off 사이*
  에 둔다. strict → off 직행 경로 차단이 핵심 의도.
- **localStorage 호환**: 기존 사용자의 `"strict"` / `"off"` 값은 그대로
  유효. 새 `"warn"` 값만 추가. 마이그레이션 코드 불필요.
- **`SafeModeState` interface 동결**: `setMode` / `toggle` 시그니처
  무변동. type 만 union 확장 (`"strict" | "off"` → `"strict" | "warn"
  | "off"`). 기존 호출자는 자동 호환.
- **순환 표 (`NEXT_MODE`)**: switch 또는 ternary 대신 `Record<SafeMode,
  SafeMode>` 룩업. 이유: 미래에 4-way (예: "audit") 를 추가할 때 한
  줄 추가로 끝남 + ESLint exhaustiveness 가 빠진 enum 분기 catch.

## 2. type-to-confirm 비교 정책

`ConfirmDangerousDialog` 의 입력 검증 규칙:

- **trim 적용**: 양 끝 공백 허용. 사용자가 IME 자동 공백을 입력해도
  통과. `typed.trim() === reason`.
- **case-sensitive**: analyzer 의 `reasons[0]` 은 항상 일관된 형식
  (`"DELETE without WHERE clause"`, `"DROP TABLE"`) 으로 emit.
  대소문자 일치 강제로 *우연한 일치* (예: 사용자가 `"drop table"` 만
  타이핑) 차단.
- **재 mismatch 시 즉시 disable**: useState 로 매 keystroke 마다
  비교 → Confirm 버튼이 즉각 disabled 로 돌아간다 (`AC-186-03e` 핀).
- **dialog 재open 시 입력 reset**: `useEffect([open, reason])` 로
  `setTyped("")`. 다른 reason 이 들어오는 fixture 에서 stale 일치가
  남지 않도록.

이유: 본 sprint 의 목적은 *사용자의 명시적 인텐트* 를 강제하는
것이지 bypass 회피의 정밀 검증이 아니다. SQL parser 가 도입되면
typing 도 더 정밀해질 수 있다 (예: 테이블명 typing) — 본 sprint 는
그 path 를 별 sprint 로 미룸.

## 3. Out of Scope DDL 정밀 typing 결정

Phase 23 spec 의 "DDL typing confirm" 은 두 해석 가능:

(a) DROP TABLE users → `"users"` 를 입력해야 진행.
(b) DROP TABLE users → reason 문자열 `"DROP TABLE"` 을 입력해야 진행.

본 sprint 는 (b) 를 채택. 이유:

- analyzer 의 `reasons[0]` 은 모든 danger kind (DELETE without WHERE /
  UPDATE without WHERE / DROP TABLE / DROP DATABASE / DROP SCHEMA /
  TRUNCATE) 에 *일관* 적으로 존재. 한 가지 typing 패턴으로 모든 위험
  shape 를 cover.
- (a) 는 SQL parser 도입 필요. 본 sprint 는 regex 기반 분류기 (Sprint
  185) 위에서 동작 — parser 를 본 sprint 가 자처하지 않음.
- 단점: `DELETE FROM users` 와 `DELETE FROM orders` 가 같은 reason
  (`"DELETE without WHERE clause"`) 을 가지므로 사용자가 *어느* 테이블
  을 다루는지 인지하지 않고 typing 만 일치시킬 수 있다. 다이얼로그가
  SQL 자체를 `<pre>` 블록으로 노출 (decorative 가 아니라 의미 단서로)
  해서 사용자가 reason 입력 전에 SQL 을 *읽도록* 유도. 이는 Trade-off.

미래 sprint (Sprint 189+) 가 SQL parser 를 도입하면 typing 정밀화
(예: `"DROP TABLE users"` 의 *테이블명* 을 별도 입력 받기) 가 가능.

## 4. warn 메시지 표준 문구

Sprint 185 의 strict-blocked 메시지와 별도로 warn 의 cancel 메시지를
표준화:

```
Safe Mode (warn): confirmation cancelled — no changes committed
```

- 두 게이트 (`useDataGridEdit.cancelDangerous`,
  `EditableQueryResultGrid.cancelDangerous`) 가 동일 문구.
- 토스트는 `toast.info` (에러 아님 — 사용자 명시적 cancel 의도).
- `commitError` / `executeError` 에 같은 문구가 들어감 — 다이얼로그가
  닫힌 뒤 SQL Preview 에서 사유가 보임.
- Confirm 시 별도 메시지 없음 — commit 이 정상 진행되어 `"N changes
  committed"` 토스트 (Sprint 183 표준) 가 그대로 발화.

문구 변경 시 양쪽 surface + 6 개 시나리오 테스트 (4개 useDataGridEdit
+ 3개 EditableQueryResultGrid 의 warn 분기) 를 함께 갱신해야 한다.

## 5. `runRdbBatch` / `runBatch` 추출 결정

`useDataGridEdit.handleExecuteCommit` 와 `EditableQueryResultGrid.handleExecute`
모두 try/catch + cleanup body 를 helper 로 추출했다. 이유:

- `confirmDangerous` 가 사용자의 명시적 confirm 후 *동일* commit body
  를 재실행해야 함. 추출 없으면 ~50 줄 코드 중복.
- helper 가 deps 를 명확히 closure 하면 useCallback dep list 가 줄어듦
  (handleExecuteCommit 은 runRdbBatch + safeMode + connectionEnvironment
  + paradigm 만).
- 회귀 가드 (`useDataGridEdit.commit-error.test.ts` 의 sql-branch
  static slice) 의 marker 를 `"if (!sqlPreview) return;"` → `"const
  runRdbBatch = useCallback("` 로 이동. 의도는 동일 (silent-swallow
  방지) 이고 slice 가 올바른 try/catch 를 cover.

## 6. AC → 테스트 매핑

| AC | 검증 위치 | 형태 |
|----|-----------|------|
| AC-186-01a~c | `src/stores/safeModeStore.test.ts` | Vitest unit |
| AC-186-02a~b | `src/components/workspace/SafeModeToggle.test.tsx` | Vitest component |
| AC-186-03a~e | `src/components/workspace/ConfirmDangerousDialog.test.tsx` | Vitest component |
| AC-186-04a~c | `src/components/datagrid/useDataGridEdit.safe-mode.test.ts` | Vitest hook |
| AC-186-05a~c | `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` | Vitest component |
| AC-186-06 | `src/components/rdb/DataGrid.test.tsx` `[AC-186-06]` | Vitest component |
| AC-186-07 | static greps + `git diff src-tauri/` + `git diff src/lib/sqlSafety.ts` | static |

신규/추가 테스트:
- safeModeStore: +3 (5 → 8)
- SafeModeToggle: +2 (3 → 5)
- ConfirmDangerousDialog: +5 (NEW)
- useDataGridEdit.safe-mode: +3 (4 → 7)
- EditableQueryResultGrid.safe-mode: +3 (4 → 7)
- DataGrid: +1 (74 → 75)
- 합계: **+17 cases**.

## 7. Evidence index

- Vitest 신규/수정 6 파일:
  - `pnpm vitest run src/stores/safeModeStore.test.ts` → **8 passed**.
  - `pnpm vitest run src/components/workspace/SafeModeToggle.test.tsx` →
    **5 passed**.
  - `pnpm vitest run src/components/workspace/ConfirmDangerousDialog.test.tsx` →
    **5 passed**.
  - `pnpm vitest run src/components/datagrid/useDataGridEdit.safe-mode.test.ts` →
    **7 passed**.
  - `pnpm vitest run src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` →
    **7 passed**.
  - `pnpm vitest run src/components/rdb/DataGrid.test.tsx` → **75 passed**.
- Vitest 전체: `pnpm vitest run` → **177 files, 2595 tests passed**.
- TypeScript: `pnpm tsc --noEmit` → exit 0.
- ESLint: `pnpm lint` → exit 0.
- Cargo test: `cd src-tauri && cargo test --lib` → **326 passed; 0 failed; 2 ignored**.
- Cargo clippy: `cargo clippy --all-targets --all-features -- -D warnings` → no warnings.
- Cargo fmt: `cargo fmt --check` → no diff.

Static greps:
- `grep -RnE 'it\.(skip|todo)|xit\(' <new test files>` → 0 matches.
- `git diff src-tauri/` → empty.
- `git diff src/types/connection.ts` → empty.
- `git diff src/lib/sqlSafety.ts src/lib/sqlSafety.test.ts` → empty.

회귀 갱신 1 건:
- `src/components/datagrid/useDataGridEdit.commit-error.test.ts` static
  regression guard 의 source-slice marker 를 `runRdbBatch` 추출에 맞게
  업데이트 (`if (!sqlPreview) return;` → `const runRdbBatch =
  useCallback(`). 의도 무변동 (sprint-93 silent-swallow 방지).

## 8. Assumptions

- analyzer 의 `reasons[0]` 형식은 Sprint 185 와 동일 (불변). 변경 시
  type-to-confirm 비교 룰 (case-sensitive trim) 이 흔들리므로 회귀
  테스트가 catch.
- `<AlertDialogContent>` (radix) 의 autoFocus 와 escape 처리는 Sprint
  96 의 `ConfirmDialog` 가 이미 사용 중인 패턴 — 신규 동작 도입 없음.
- `lucide-react` 의 `ShieldAlert` 는 이미 dependency 에 포함 (다른
  warn 표시 용도로 import 가능).
- Mongo paradigm 의 commit 동작은 `useDataGridEdit.handleExecuteCommit`
  의 *상단* `paradigm === "document"` 분기에서 분기한다 — 본 sprint 의
  warn 분기는 그 *후* 의 RDB 분기에만 inject. Mongo 무영향.

## 9. Residual risk

- **다중 danger statement 의 batch confirm**: 본 sprint 는 *첫* danger
  에서 멈추고 다이얼로그 표시. 사용자가 Confirm 시 batch 전체 (그 안의
  다른 danger 도) 가 commit. step-by-step confirm 은 별 sprint.
- **Structure surface 색띠 + warn**: `ColumnsEditor` / `IndexesEditor` /
  `ConstraintsEditor` 가 사용하는 별 dialog 는 본 sprint cover 안 함.
  Sprint 187.
- **Mongo dangerous-op + warn**: Mongo `deleteMany({})` 같은 위험 op
  는 본 sprint 의 warn 다이얼로그가 cover 하지 않음. Sprint 188.
- **type-to-confirm bypass**: 사용자가 reason 문자열을 외워서 빠르게
  타이핑하는 path 는 본 sprint 가 막지 않는다. typing 자체가 *기억
  효과* (사용자가 reason 을 보고 타이핑하면서 인지) 를 의도한 것이지
  bypass 차단이 아님.
- **Cross-window warn 동작**: 한 window 에서 warn 다이얼로그가 열린
  사이에 다른 window 가 모드를 strict 로 변경하면 어떻게 되는가?
  - 답: zustand `mode` 만 broadcast. 다이얼로그는 component-local
    `pendingConfirm` state 에 의존하므로 window-local. 다른 window 의
    모드 변경은 *현재 다이얼로그* 에 영향 없음. 사용자가 Confirm 또는
    Cancel 한 후 다음 commit 부터 새 모드 적용.

## 10. Phase 23 진행 상태

- ✅ Sprint 185 (MVP — strict / off + production 가드 + 색띠).
- ✅ Sprint 186 (warn 모드 + type-to-confirm) — 본 sprint.
- ⏳ Sprint 187: structure surface 색띠 (3 editor: Columns / Indexes /
  Constraints) — `SqlPreviewDialog` 색띠 + warn 가드.
- ⏳ Sprint 188: Mongo dangerous-op 분류 + Mongo paradigm 게이트.

Phase 23 종료는 Sprint 187 + 188 완료 시점.
