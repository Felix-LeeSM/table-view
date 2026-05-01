# Sprint 187 — Findings

Sprint: `sprint-187` (Phase 23 / Structure surface 색띠 + warn 가드).
Date: 2026-05-01.
Sprint 186 commit: `8bbc5a7`.

## 1. Goal recap

Sprint 185 가 도입한 환경 색띠 + Sprint 186 의 type-to-confirm warn
다이얼로그를 **structure surface** (테이블 스키마 편집기) 의 SQL
preview 위에 그대로 확장. 3 개 편집기 (`ColumnsEditor`, `IndexesEditor`,
`ConstraintsEditor`) 가 공통으로 쓰는 `SqlPreviewDialog` 에 색띠 slot
을 추가하고, 각 편집기의 commit 핸들러에 strict / warn 가드를 inject.
백엔드 변경 0.

## 2. Why this sprint exists

Sprint 185 / 186 의 가드는 데이터 평면 (DataGrid 의 row commit + raw
query editor) 만 cover 했다. 구조 평면 (스키마 변경) 은 사용자가 명시
적으로 DDL 을 작성하지 않더라도 `DROP COLUMN`, `DROP CONSTRAINT`,
`DROP INDEX` 를 1-click 으로 발생시킬 수 있어 — production 에서 가드
없이 commit 시 즉시 데이터 손실. 본 sprint 가 이 격차를 닫는다.

## 3. Key design decisions

### 3.1 Analyzer 확장 (AC-187-01)

기존 `analyzeStatement` 는 `DROP TABLE/DATABASE/SCHEMA` 만 danger 로
분류. structure surface 가 emit 하는 다음을 새로 cover:

- `DROP INDEX <name>` → `kind: "ddl-drop"`, `reasons: ["DROP INDEX"]`.
  `DROP TABLE` 분기를 `(TABLE|DATABASE|SCHEMA|INDEX|VIEW)` 로 확장. VIEW
  는 trial-level 이지만 사용자가 raw editor 에서 칠 수 있어 일관성 위해
  추가.
- `ALTER TABLE … DROP COLUMN` → 신규 `kind: "ddl-alter-drop"`,
  `reasons: ["ALTER TABLE DROP COLUMN"]`.
- `ALTER TABLE … DROP CONSTRAINT` → 동일 kind,
  `reasons: ["ALTER TABLE DROP CONSTRAINT"]`.

`StatementKind` 에 `"ddl-alter-drop"` 추가 (비-breaking union 확장).
`ALTER TABLE … ADD COLUMN` / `ADD CONSTRAINT` / `CREATE INDEX` /
`CREATE TABLE` 은 `ddl-other / safe` 유지 (회귀 invariant —
`[AC-187-01e]` 가 ADD COLUMN 의 안전성을 핀).

### 3.2 PreviewDialog 의 `headerStripe` slot (AC-187-02)

DataGrid + EditableQueryResultGrid 는 raw `<Dialog>` primitive 를
직접 마운트해서 색띠를 인라인으로 삽입한다. structure surface 는
공유 `PreviewDialog` (Sprint 96 layer 2 preset) 위에 있으므로 동일
패턴이 안 맞는다. `PreviewDialog.headerStripe?: ReactNode` slot 을
추가 — `<DialogHeader>` 위 위치, default `null`. 이 slot 은
`PreviewDialog` 의 모든 기존 caller (CellDetailDialog 포함) 에 무영향.

### 3.3 구조용 `SqlPreviewDialog` 의 `environment` prop (AC-187-03)

`environment?: string | null` (loose) 으로 받아 runtime 에서
`environment in ENVIRONMENT_META` 가드 후 `as EnvironmentTag` 로 좁힘.
loose 타입 채택 이유: store 의 `Connection.environment` 가 옵션 +
사용자 입력이 들어올 수 있어 `EnvironmentTag` 로 강제하면 caller 마다
cast 가 필요. DataGrid / EditableQueryResultGrid 의 인라인 stripe 도
같은 패턴 (`as EnvironmentTag`) 이라 일관성 유지.

### 3.4 Gate 위치 — preview-dialog Execute 이후

`ColumnsEditor.handleExecute` / `IndexesEditor.handlePreviewConfirm` /
`ConstraintsEditor.handlePreviewConfirm` 은 모두 *사용자가 SQL preview
를 확인한 뒤* 호출되는 함수. 가드를 여기에 두면:

- `previewSql` 이 이미 채워져 있어 `;` 로 split → 각 statement 분석
  가능.
- "Review SQL" 버튼은 막지 않음 — preview 는 항상 보여준다 (`preview_only`
  은 read-only). 가드는 commit 단계에만.

### 3.5 Multi-statement split

Columns editor 는 한 번의 commit 에서 여러 ALTER 를 `;` 로 join 한다.
Gate 는 `previewSql.split(";").map(trim).filter(Boolean)` 후 *어떤*
statement 가 danger 라면 즉시 차단. 사용자가 ADD COLUMN 과 DROP COLUMN
을 같이 commit 해도 DROP 이 트리거. `;` 가 string literal 안에 있어도
splittable — structure surface 의 SQL 은 generator 가 만든 것이므로
악성 quoting 위험 없다.

### 3.6 Cancel 메시지는 toast 가 아니라 `previewError`

Sprint 186 의 useDataGridEdit / EditableQueryResultGrid 는 cancel 시
`toast.info` + `commitError` 를 같이 set. 구조 편집기는 dialog 가
이미 `previewError` 를 자체 banner 로 표시 — 별도 toast 는 노이즈만
늘림. 따라서 `setPreviewError("Safe Mode (warn): confirmation cancelled
— no changes committed")` 만 한다. 표준 문구는 Sprint 186 과 동일
(공통 string).

### 3.7 helper 추출 안 함

세 편집기에 같은 가드 코드 (~25줄) 이 repeat. helper module 추출도
검토했으나:

- 모듈 추가 → 새 파일 → contract Files-allowed list 갱신 + import 그래프
  변경. 본 sprint 의 risk profile 을 키움.
- 가드 자체가 "production + safeMode + analyzeStatement loop + setError /
  setPendingConfirm" — caller 별 setter 가 다 다름 (ColumnsEditor 는
  `setPreviewError`, IndexesEditor / ConstraintsEditor 도 같은 이름이지만
  context 가 다름). 일반화하려면 callbacks (4–5 개) 을 받는 hook 이
  되어 — 결국 site 에서 `useSafeModeGate({ onStrict, onWarn, ... })`
  로 부르는 게 inline 보다 verbose.
- Sprint 188 이 Mongo paradigm 으로 가드 패턴을 재사용할 때 그때 같이
  helper 화 하기로 결정.

inline 채택. 3 곳 중복은 acceptable (`docs/sprints/sprint-187/handoff.md`
에 코드 위치 기록).

## 4. Out of Scope (재확인)

- `useDataGridEdit` / `EditableQueryResultGrid` 의 코드 변경 0. 본
  sprint 의 analyzer 확장은 두 컴포넌트의 기존 warn 가드에 *자동* 반영
  (사용자가 raw editor 에 `DROP INDEX` 친 경우 — 이미 Sprint 186 의
  warn 다이얼로그가 동일 코드 경로로 트리거됨).
- Mongo paradigm 의 dangerous-op 가드 — Sprint 188.
- DDL 의 *테이블명* typing override — Sprint 186 contract 와 동일
  (parser 도입 후 별 sprint).

## 5. AC → Test mapping

| AC | 단위/시나리오 | 파일 / 케이스 |
|----|--------------|------------------|
| AC-187-01 | analyzer DDL 분류 확장 | `src/lib/sqlSafety.test.ts` — `[AC-187-01a~e]` (DROP INDEX / VIEW / ALTER … DROP COLUMN / CONSTRAINT / ADD COLUMN regression). |
| AC-187-02 | `PreviewDialog.headerStripe` slot | `src/components/ui/dialog/PreviewDialog.tsx` (코드 변경). 회귀는 downstream `SqlPreviewDialog.test.tsx` 의 `[AC-187-03a]` 가 cover. |
| AC-187-03 | 색띠 렌더 | `SqlPreviewDialog.test.tsx` — `[AC-187-03a]`. |
| AC-187-04 | ColumnsEditor strict/warn/confirm/cancel/non-prod | `ColumnsEditor.test.tsx` — `[AC-187-04a~e]` (5). |
| AC-187-05 | IndexesEditor 동일 5 시나리오 | `IndexesEditor.test.tsx` (NEW) — `[AC-187-05a~e]`. |
| AC-187-06 | ConstraintsEditor 동일 5 시나리오 | `ConstraintsEditor.test.tsx` (NEW) — `[AC-187-06a~e]`. |
| AC-187-07 | invariants + 전체 회귀 | full vitest + tsc + lint + cargo + git diff (Sprint 186 산출물 / src-tauri / connection.ts empty). |

## 6. Test count delta

- `src/lib/sqlSafety.test.ts`: 14 → 19 (+5).
- `src/components/structure/SqlPreviewDialog.test.tsx`: 5 → 6 (+1).
- `src/components/structure/ColumnsEditor.test.tsx`: 4 → 9 (+5).
- `src/components/structure/IndexesEditor.test.tsx`: 0 → 5 (+5, NEW).
- `src/components/structure/ConstraintsEditor.test.tsx`: 0 → 5 (+5, NEW).
- 합계 +21 cases.

## 7. Verification

| Gate | Result |
|------|--------|
| `pnpm vitest run` (5 changed files) | 5 files / 44 tests passed. |
| `pnpm vitest run` (full suite) | 179 files / 2616 tests passed. |
| `pnpm tsc --noEmit` | 0 errors. |
| `pnpm lint` | 0 errors. |
| `cargo test --lib` | 326 passed, 0 failed, 2 ignored. |
| `cargo clippy --all-targets --all-features -- -D warnings` | clean. |
| `cargo fmt --check` | clean. |
| `git diff src-tauri/` | empty. |
| `git diff src/types/connection.ts` | empty. |
| `git diff src/components/workspace/ConfirmDangerousDialog.tsx src/components/workspace/SafeModeToggle.tsx src/stores/safeModeStore.ts` | empty (Sprint 186 산출물 동결). |
| skip-zero grep on 5 changed test files | 0 matches. |

## 8. Risks / follow-ups

- **Multi-statement ALTER batch** — gate 는 첫 danger 에서 끊긴다.
  사용자가 Confirm 누르면 *전체* batch (ADD + DROP 혼합) 가 commit.
  step-by-step confirm 은 별 sprint 가 필요 (큰 UX 변경).
- **VIEW drop** — 본 sprint 는 `DROP VIEW` 를 danger 로 추가했지만
  view 편집 surface 가 아직 없다 (`listViews` 만 존재). `DROP VIEW`
  trigger 는 raw query editor 에서만 발생 — Sprint 186 의 warn 가드가
  이미 처리.
- **Mongo dangerous-op (Sprint 188)** — `db.coll.drop()`,
  `deleteMany({})` 의 분류는 SQL analyzer 와 별 평면. Sprint 188 에서
  Mongo paradigm dispatcher 에 별도 분석기 추가.

## 9. Phase 23 진행 상황

- Sprint 185 (색띠 + strict) — 완료 (commit `6f4006d`).
- Sprint 186 (warn + type-to-confirm) — 완료 (commit `8bbc5a7`).
- **Sprint 187 (structure surface) — 본 sprint, 구현 완료.**
- Sprint 188 (Mongo dangerous-op) — 다음, Phase 23 종료 트리거.

## 10. 후속 sprint 메모

- `Sprint 188` 시작 시 본 sprint 의 inline gate 코드 (3 site × ~25 line)
  를 helper hook 으로 추출 가능 — Mongo dispatcher 가 4 번째 site 가
  되면 helper 가 합리적.
- analyzer 의 `ddl-alter-drop` kind 는 향후 telemetry / audit log 에서
  분류로 쓰일 수 있다 (현재는 severity 만 사용).
