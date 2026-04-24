# Sprint 70 Handoff — Phase 6 plan D-1 (BsonTreeViewer component + tests)

## Status: PASS (after evaluator feedback applied)

Sprint 70 scope(BsonTreeViewer 컴포넌트 + 테스트)에 해당하는 5개 generator-scope check 전부 통과 (Sprint 70 scope 기준). Orchestrator-scope 회귀 체크 2개도 Sprint 70 파일에 대해 clean.

### Evaluator Feedback 1차 반영
1차 evaluator 평가에서 AC-06을 잡힘 — contract가 "객체/배열 노드도 값 복사 버튼 제공"을 요구하는데 구현이 `!hasChildren` 게이트 때문에 스칼라만 버튼이 렌더되던 miss. 수정 후 재검증:

- `BsonTreeViewer.tsx:278-287` — `!hasChildren &&` 게이트 제거, 모든 노드에 Copy value 버튼 렌더.
- `BsonTreeViewer.tsx:208-218` — `handleCopyValue`가 컨테이너일 때 `JSON.stringify(value, null, 2)` 들여쓰기, 스칼라는 기존 `canonicalStringify` 유지.
- `BsonTreeViewer.test.tsx` — 3 테스트 추가:
  - `copies indented JSON for an object container value`
  - `copies indented JSON for an array container value`
  - `uses bracket-quote path form for non-identifier keys` (evaluator P3 feedback도 함께 해결)

## Changed Files

| File | Purpose |
|---|---|
| `src/components/shared/BsonTreeViewer.tsx` | 신규(이전 generator가 450줄 작성) — contract와 대조 후 변경 없음. 감사 통과. |
| `src/components/shared/BsonTreeViewer.test.tsx` | 신규 — 12 tests, AC-01~AC-09 전부 커버. |
| `docs/sprints/sprint-70/contract.md` | 스프린트 계약서(재작성). |
| `docs/sprints/sprint-70/execution-brief.md` | 생성자용 브리핑(재작성). |
| `docs/sprints/sprint-70/handoff.md` | 이 파일. |

변경 범위 제약 준수: `QuickLookPanel.tsx`, `DocumentDataGrid.tsx`, `src/types/document.ts`, `src-tauri/**`, 기타 in-flight 파일 **전부 diff 0**.

## Generator-scope Check Results

### 1. `cd src-tauri && cargo fmt --all -- --check`
PASS — stdout 없음 (= clean).

### 2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
PASS — `Finished dev profile ... 0 warnings`.

### 3. `pnpm vitest run src/components/shared/BsonTreeViewer.test.tsx`
PASS — `Test Files 1 passed (1)`, `Tests 15 passed (15)`, duration 877ms (AC-06 수정 후 3 테스트 추가).

### 4. `pnpm lint`
**Scope-wise PASS, ambient 2 errors**.

`pnpm eslint src/components/shared/BsonTreeViewer.tsx src/components/shared/BsonTreeViewer.test.tsx` → 0 errors.

전체 `pnpm lint`는 `src/components/datagrid/DataGridTable.editing-visual.test.tsx`에서 `TS6133 unused import` 2 에러(`fireEvent`, `act`). 이 파일은 git status 상 113줄 insertions을 가진 다른 agent의 작업물(`git diff --stat HEAD` 확인). Sprint 70과 무관.

### 5. `pnpm tsc --noEmit`
**Scope-wise PASS, ambient 2 errors**.

동일한 파일(`DataGridTable.editing-visual.test.tsx:2`)의 TS6133. 이전 evaluator 평가 시점에는 이 5 TS 에러가 `DataGrid.tsx`/`useDataGridEdit.ts`에 있었으나 그 사이 다른 agent가 수정하면서 에러 위치만 이동. 공통점: **Sprint 70 파일에는 TS 에러 0건**이고 BsonTreeViewer.{tsx,test.tsx}는 어떤 DataGrid 모듈도 import 하지 않음.

## AC → Test Mapping

모든 매핑은 `src/components/shared/BsonTreeViewer.test.tsx` 기준. 총 15 테스트 (AC-06 수정 + path format 추가).

| AC | 테스트 이름 | 근거 |
|---|---|---|
| AC-01 | `renders a nested document/array as a tree with root expanded` | `role="tree"` + depth ≤ 1 expanded 확인 |
| AC-02 | `toggles aria-expanded on mouse click and keyboard (Enter/Space)` | mouse click / Enter / Space 3-경로 확인 |
| AC-03 | `renders canonical extended JSON wrappers as scalar badges` | 7종 뱃지(ObjectId/ISODate/NumberLong/NumberDouble/NumberInt/Decimal128/Binary) |
| AC-04 | `does not misdetect non-whitelisted $-keys as badges` + `detectBsonBadge accepts the $binary + $type 2-key wrapper only` | `$comment` → 뱃지 아님, unit level detectBsonBadge 음성 케이스 |
| AC-05 | `copies the field path to clipboard on key click` + `uses bracket-quote path form for non-identifier keys` | 중첩 경로 `user.profile.emails[0]` + 비식별자 키 `["foo bar"]` |
| AC-06 | `copies the canonical JSON of a scalar node via Copy value` + `copies the canonical JSON of a string scalar with quotes` + `copies indented JSON for an object container value` + `copies indented JSON for an array container value` | 스칼라(number `42`, string `"hello"`) + 컨테이너(object/array) 모두 검증 |
| AC-07 | `renders a safe empty state when the value is null` | `No document selected` 메시지 + tree role 유지 |
| AC-08 | `renders an empty object without throwing` + `renders an empty array without throwing` + `renders a 6-deep nested structure without crashing` | 빈 객체 / 빈 배열 / 6단계 중첩 |
| AC-09 | (위 5개 generator-scope check 결과) | 본 문서 §"Generator-scope Check Results" 참조 |

AC-01 ~ AC-08 각각 ≥ 1 테스트, AC-09는 verification plan 체크 자체.

## 뱃지 Whitelist 판정 로직 위치

- `BSON_WRAPPERS` 상수: `src/components/shared/BsonTreeViewer.tsx:14-29` (14종 wrapper 전수 나열)
- `detectBsonBadge()` 함수: `src/components/shared/BsonTreeViewer.tsx:59-106`
  - 1-key whitelist 검사: L68-91 (special case: `$regularExpression`은 value가 `{pattern, options}` 객체일 때만 인정)
  - 2-key `$binary + $type` legacy 형식 검사: L96-103
  - fall-through: null 반환 (object 노드로 렌더)

경로 포맷 규칙 (`joinObjectPath`/`joinArrayPath`): `src/components/shared/BsonTreeViewer.tsx:117-131`
- 식별자 키 → `.key`
- 비식별자 키 → `["escaped"]`
- 배열 인덱스 → `[i]`
- 루트 빈 문자열 → `handleCopyPath`가 `"$"`로 변환 (L199-206)

## Assumptions

- **뱃지 whitelist 규칙**: 1-key일 때 whitelist 포함 + `$regularExpression`은 추가 shape 검사. 2-key는 `$binary + $type` 조합만 허용.
- **경로 포맷**: 식별자 키 = `/^[A-Za-z_$][\w$]*$/`, 그 외는 bracket-quote.
- **클립보드 API**: `navigator.clipboard.writeText`만 사용. `document.execCommand("copy")` 폴백 없음 (contract 명시).
- **테스트 환경**: jsdom 29 + vitest 4 + `@testing-library/user-event`. `userEvent.setup()`이 `navigator.clipboard`를 자체 구현으로 치환하기 때문에, 클립보드 단언이 있는 테스트는 `fireEvent` + `beforeEach`에서 `Object.defineProperty`로 mock 재설치하는 패턴 사용.

## Residual Risk

- **pnpm tsc ambient failure**: 다른 agent가 `DataGrid.tsx`에서 `Map<string, string | null>`로 타입을 확장하기 전까지 `pnpm tsc --noEmit` 은 ambient 에러 유지. Sprint 70과 인과 없으나 orchestrator의 전체 회귀 체크 시 이 5 에러가 남아있으면 그 agent의 handoff에서 처리될 것.
- **대용량 문서 성능**: Phase 6 scope 밖. 1MB 이상 문서에서 Quick Look 성능은 추후 lazy-load로 처리 예정 (master plan 언급).
- **Sprint 71 통합 준비물**: BsonTreeViewer 의 public API (`value`, `rootLabel`)만 contract에 정의됨. `QuickLookPanel`이 `paradigm === "document"` 분기에서 바로 consume 가능. `DocumentDataGrid` 의 selection/이동 로직은 Sprint 71 범위.

## Orchestrator-scope Checks (실행 완료)

### `cd src-tauri && cargo test --lib`
PASS — `215 passed; 0 failed; 0 ignored`. Rust 변경 없음을 증명.

### `pnpm vitest run` (전체 suite)
PASS — Evaluator 1차 평가 이후 2차 재실행 결과:
- Test Files: 69 passed (69)
- Tests: **1232 passed (1232)**, 실패 0

BsonTreeViewer 15개 테스트 포함 전체 suite green. 1차 평가 당시 보고했던 3 ambient failure는 다른 agent가 그 사이 수정 완료. Sprint 70 추가 파일은 DataGrid 계열 모듈을 import하지 않으므로 회귀 책임 없음.

## References

- Contract: `docs/sprints/sprint-70/contract.md`
- Execution brief: `docs/sprints/sprint-70/execution-brief.md`
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint D 섹션, D-1/D-2 분할)
- 이전 Sprint 66 handoff: `docs/sprints/sprint-66/handoff.md`
