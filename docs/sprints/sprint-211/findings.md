# Sprint 211 Findings

## Verdict: PASS
## Overall Score: 8.5/10

## Dimension Scores
| Dimension | Score | Notes |
| --- | --- | --- |
| Correctness | 9/10 | 980-line test 51/51 pass, project 2725/2725 pass, ARIA + 상수 + dispatch ordering 모두 보존. 행동 diff 0. |
| Completeness | 8/10 | AC-01..05 + Global AC-1..10 모두 충족. 단, spec 32행 "FieldRow / EditableValue 는 helpers.ts 안에 거주" 조항을 6번째 파일로 분리 — 기술적 제약(@vitejs/plugin-react `.ts` JSX 거부) 으로 정당화 가능하나 spec literal text 일탈. P3. |
| Reliability | 9/10 | 12 hardcoded check 전부 exit 0. tsc 0건, lint 0건, 새 eslint-disable 0, 새 silent catch 0, 기존 swallow comment 보존. |
| Verification Quality | 8/10 | Generator 자기 보고가 모두 evaluator 재실행과 일치. 단 6번째 파일(FieldRow.tsx) 추가 사실을 evidence packet 에 명시한 점은 정직성 +. |

## Per-AC Evaluation

### Sprint Acceptance Criteria

- **AC-01: PASS** — entry path + public surface 보존.
  - `wc -l src/components/shared/QuickLookPanel.tsx` → `176` (< 250 ✓).
  - `grep -rn 'from "@components/shared/QuickLookPanel"' src e2e` → `src/components/rdb/DataGrid.tsx:26`, `src/components/document/DocumentDataGrid.tsx:6` (정확히 pre-sprint 의 2 importer ✓).
  - `git diff --stat src/components/rdb/DataGrid.tsx src/components/document/DocumentDataGrid.tsx` → 빈 출력 (importer 변경 0 ✓).
  - `grep -n "export interface QuickLookPanelRdbProps\|export interface QuickLookPanelDocumentProps\|export type QuickLookPanelProps" src/components/shared/QuickLookPanel.tsx` → line 56, 66, 82 (3 매치 ✓).
  - default export 는 `QuickLookPanel` React 컴포넌트 (line 86, `export default function`).

- **AC-02: PASS** — 5 listed sub-file 모두 존재 + 비어있지 않음.
  - `src/components/shared/QuickLookPanel.tsx` (entry, 176 lines).
  - `src/components/shared/QuickLookPanel/QuickLookShell.tsx` (134 lines).
  - `src/components/shared/QuickLookPanel/RdbQuickLookBody.tsx` (137 lines).
  - `src/components/shared/QuickLookPanel/DocumentQuickLookBody.tsx` (143 lines).
  - `src/components/shared/QuickLookPanel/helpers.ts` (105 lines).
  - 추가로 `src/components/shared/QuickLookPanel/FieldRow.tsx` (333 lines) — spec 의 "FieldRow + EditableValue 는 helpers.ts 거주" 항목을 깬 6번째 파일. Generator 사유 = `@vitejs/plugin-react` 가 `.ts` 파일의 JSX 를 파싱하지 않음. 본 evaluator 는 이를 P3 으로 분류 (이유는 F-001 참조).

- **AC-03: PASS** — entry + 단일 sub-file 모두 cap 충족.
  - `wc -l src/components/shared/QuickLookPanel.tsx` → `176` (< 250, 868→176 = **79.7 %** 감소; spec 70 % 목표 초과 달성 ✓).
  - `wc -l src/components/shared/QuickLookPanel/*.{ts,tsx}` 최대 = `333` (FieldRow.tsx) < 400 ✓.

- **AC-04: PASS** — test 변경 0 + 타깃 suite exit 0.
  - `git diff src/components/shared/QuickLookPanel.test.tsx | wc -l` → `0` (byte-for-byte 변경 0 ✓).
  - `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` → `Test Files 1 passed (1) | Tests 51 passed (51)` (✓).

- **AC-05: PASS** — 프로젝트 회귀 0 + 새 eslint-disable 0.
  - `pnpm vitest run` → `Test Files 189 passed (189) | Tests 2725 passed (2725)` (post-Sprint-210 baseline 동일 ✓).
  - `pnpm tsc --noEmit` exit `0` ✓.
  - `pnpm lint` exit `0` ✓.
  - `git diff src/components/shared/QuickLookPanel.tsx src/components/shared/QuickLookPanel/ | grep '^+.*eslint-disable'` → `0 additions` ✓.

### Global Acceptance Criteria

- **Global AC-1: PASS** — 행동 변경 = 0. 980-line test 변경 0 + 51/51 pass.
- **Global AC-2: PASS** — 외부 import 단일 barrel. `grep -rn 'from "@components/shared/QuickLookPanel/'` → 0 매치 (sub-file external 노출 0). importer 2개는 entry 만 import.
- **Global AC-3: PASS** — ARIA 보존.
  - QuickLookShell.tsx: `role="region"` (L79), `aria-label={regionLabel}` (L80, RDB="Row Details"/Document="Document Details"), `role="separator"` (L88), `aria-orientation="horizontal"` (L89), `aria-label="Resize Quick Look panel"` (L90), `aria-valuemin={MIN_HEIGHT}=120` (L91), `aria-valuemax={MAX_HEIGHT}=600` (L92), `aria-valuenow={height}` (L93), `tabIndex={0}` (L87), `aria-label="Toggle edit mode"` + `aria-pressed={editing}` (L111-112), close `aria-label={closeLabel}` (L123).
  - FieldRow.tsx: `Edit value for ${name}` (L244, 270, 307), `Set NULL for ${name}` (L291, 326), `Value for ${name}` (L146, read-only large-text textarea), `View BLOB data for ${name}` (L131).
- **Global AC-4: PASS** — Resize semantics 보존.
  - entry `QuickLookPanel.tsx` L97-122: mouse drag (`startY - moveEvent.clientY` → up=grow), document `mouseup` 핸들러가 `cursor` / `userSelect` 복원 (L112-113).
  - entry L129-138: `e.shiftKey` 가 false 면 early-return (plain Arrow no-op), `ArrowUp` += step, `ArrowDown` -= step, `clampHeight` 적용 [120,600].
  - test L860/884/889/903/917/932 등 검증.
- **Global AC-5: PASS** — Edit dispatch ordering 보존.
  - FieldRow.tsx EditableValue `dispatchSave` (L203-211): `handleStartEdit(rowIdx, colIdx, original) → setEditValue(next) → saveCurrentEdit()` 정확한 순서.
  - `dispatchSetNull` (L213-216): `setDraft("")` 후 `dispatchSave(null)` 호출.
  - boolean = 3-way Select (L223-261).
  - textarea (jsonb / object / json-string / large-text) (L263-299): `Cmd/Ctrl+Enter` saves (L278-281), 평이 `Enter` 는 newline.
  - input (L301-322): Enter saves (L314-317).
  - Esc revert (L273-275, L310-312): `setDraft(initialString)` only — no dispatch.
- **Global AC-6: PASS** — PK / BLOB / `_id` 읽기전용.
  - helpers.ts `isEditableColumn` (L85-89): `is_primary_key` 또는 BLOB family → false.
  - FieldRow.tsx L81: `editable = editing && !!editState && isEditableColumn(column)` → editable=false 일 때 `<input>` 렌더 안 됨.
  - FieldRow.tsx L155-162: `editing && !!editState && !isEditableColumn(column)` → `(read-only)` 마커 출력.
  - 도큐먼트 `_id` 도 동일 게이트 (synthesized columns 의 `is_primary_key=true`).
- **Global AC-7: PASS** — Dirty-pill propagation.
  - helpers.ts `selectedRowIsDirty` (L95-105): `${selectedRowIdx}-` prefix 키 존재 시 true.
  - RdbQuickLookBody.tsx L74-78 + DocumentQuickLookBody.tsx L75-79: `selectedRowIsDirty(firstSelectedId, editState?.pendingEdits ?? new Map())` 계산해 `isDirty` 로 shell 전달.
  - QuickLookShell.tsx L102-106: `isDirty && (...)`로 `● Modified` 렌더; `editState` 없으면 onToggleEdit 도 없음 → 읽기전용 call-site 0 노출.
- **Global AC-8: PASS** — BLOB viewer wiring.
  - RdbQuickLookBody.tsx L55-58: 로컬 `{data, columnName} | null` 상태.
  - L67-72: `handleBlobView` 가 setBlobViewer 호출.
  - L125-134: `BlobViewerDialog` mount, `onOpenChange(false)` 시 `setBlobViewer(null)`.
  - DocumentQuickLookBody.tsx 는 `BlobViewerDialog` import 없음 + L131-133 `onBlobView` no-op.
- **Global AC-9: PASS** — Document tree-vs-FieldRows toggle.
  - DocumentQuickLookBody.tsx L84: `showFieldRows = editing && !!editState && !!data`.
  - L123-140: `showFieldRows && editRow && data` 면 FieldRow 리스트, 그 외 `<BsonTreeViewer value={documentValue} />`.
  - documentValue (L62-71) 가 out-of-bounds / null → `BsonTreeViewer` 가 자체 empty state (`/No document selected/i`) 렌더 (panel 자체는 unmount 안 함 ✓).
  - `editState` 없으면 QuickLookShell.tsx L107 의 Edit 토글 자체 미렌더.
- **Global AC-10: PASS** — silent error swallowing 미추가.
  - helpers.ts L62-66: `try { JSON.stringify(value, null, 2) } catch { /* Value has cycles — fall back to String(). */ return String(value) }` — 원본 사유 코멘트 보존 + 회복 액션 명시.
  - helpers.ts L71-77: `try { JSON.parse(value) } catch { /* String didn't parse as JSON — render verbatim. */ return String(value) }` — 동일.
  - 새 untyped `catch {}` 0건 (`grep -n "catch" src/components/shared/QuickLookPanel/helpers.ts` 결과 = 위 두 줄만).
  - FieldRow.tsx / 다른 sub-file 에 catch 0건.

### Verification Plan Checks (12)

| # | Command | Generator 보고 | Evaluator 재현 | Match |
| --- | --- | --- | --- | --- |
| 1 | `wc -l src/components/shared/QuickLookPanel.tsx` | 176 < 250 | `176` | ✓ |
| 2 | `ls src/components/shared/QuickLookPanel/{...4 paths}` | 4 exist | 5 paths 모두 존재 (FieldRow.tsx 추가 포함 6 entry total) | ✓ |
| 3 | `wc -l src/components/shared/QuickLookPanel/*.{ts,tsx}` max | 333 < 400 | `333` (FieldRow.tsx) | ✓ |
| 4 | `git diff --stat src/components/shared/QuickLookPanel.test.tsx` | empty | empty | ✓ |
| 5 | `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` | 51/51 pass | `Test Files 1 passed (1) Tests 51 passed (51)` exit 0 | ✓ |
| 6 | `pnpm vitest run` | 189 files / 2725 tests | `Test Files 189 passed (189) Tests 2725 passed (2725)` exit 0 | ✓ |
| 7 | `pnpm tsc --noEmit` | exit 0 | exit 0 | ✓ |
| 8 | `pnpm lint` | exit 0 | exit 0 | ✓ |
| 9 | `grep -rn 'from "@components/shared/QuickLookPanel/' src e2e` | 0 매치 | 0 매치 (빈 출력) | ✓ |
| 10 | `grep -rn 'from "@components/shared/QuickLookPanel"' src e2e` | 2 매치 | `DataGrid.tsx:26` + `DocumentDataGrid.tsx:6` (2) | ✓ |
| 11 | `grep -n "export interface QuickLookPanelRdbProps\|export interface QuickLookPanelDocumentProps\|export type QuickLookPanelProps"` | 3 매치 | line 56, 66, 82 (3) | ✓ |
| 12 | git diff entry+subdir grep `^+.*eslint-disable` | 0 | `0 eslint-disable additions` | ✓ |

12/12 모두 일치. Generator 자기 보고와 evaluator 재실행 결과 차이 0.

## Findings

### F-001 [P3] — 6번째 sub-file (FieldRow.tsx) 추가, spec literal text 일탈

**관찰**: spec.md L32 는 "**`helpers.ts` (create): pure helpers + per-cell renderers shared across bodies. ... `FieldRow` + `EditableValue` components (since both bodies render them and they depend on the helpers). No JSX outside `FieldRow` / `EditableValue`.**" 라고 명시했다. 즉 `FieldRow` + `EditableValue` 는 `helpers.ts` 안에 거주해야 한다는 의도가 있었다. Generator 는 이를 별도 파일 `FieldRow.tsx` (333 lines) 로 분리해 6번째 sub-file 을 만들었다.

**Generator 사유 (helpers.ts L1-7 + 전달된 evidence packet)**: `@vitejs/plugin-react` 는 `.ts` 파일의 JSX 를 파싱하지 않으며, JSX 를 `.ts` 에 강제로 넣으면 빌드 실패. spec 의 verification check #2 (`ls ... helpers.ts`) 와 #3 (`*.{ts,tsx}` glob 의 단일 파일 < 400) 가 `helpers.ts` 라는 literal 파일명을 요구하므로 `.tsx` 로 rename 도 불가. 또한 `FieldRow` + `EditableValue` 를 모두 `helpers.tsx` 에 합치면 462 lines (spec 의 400-line cap 위반).

**Evaluator 평가**:
- vite.config.ts L2 + tsconfig.json L13 (`"jsx": "react-jsx"`) 확인 → Generator 사유 사실. `@vitejs/plugin-react` default 는 `.tsx`/`.jsx` 만 JSX parse.
- AC-02 의 verification text 는 "**all five of the following files exist**" — "exactly five" 가 아니라 "이 5개가 존재" 로 읽힌다. 6번째 추가는 AC-02 literal text 위반은 아님.
- AC-03 의 verification glob `wc -l src/components/shared/QuickLookPanel/*.{ts,tsx}` 는 모든 sub-file 을 캐치하므로 333-line FieldRow.tsx 도 cap 검증을 받는다. 회피 없음.
- check #9 (`from "@components/shared/QuickLookPanel/"` 외부 매치) → FieldRow.tsx 는 sub-file 끼리만 import (RdbQuickLookBody.tsx L23, DocumentQuickLookBody.tsx L25), 외부 노출 0.
- 12 hardcoded check 모두 통과.
- 행동 보존 100 % (980-line test 51/51 pass).
- inline justification comment (helpers.ts L1-7, FieldRow.tsx L1-7) 가 사유 documenting.

**P3 분류 사유**: spec text 의 "FieldRow / EditableValue lives in helpers.ts" 는 의도(intent) 였고, verification check 와 AC-02 wording 은 그 의도를 강제하지 못한다. 실제로 강제하려면 contract 가 "exactly five sub-files, no more" 라고 명시하거나 verification 에 `find src/components/shared/QuickLookPanel -type f | wc -l` 같은 count check 를 넣었어야 한다. 현 spec/contract 로는 P1/P2 fail 근거가 약하고, 기술적 제약은 정당하며, 행동 보존 + 모든 ACs pass 라는 사실이 결정적. 후속 sprint 에서 spec 작성 protocol 을 보강할 정보가치 있는 finding 이지만, sprint-211 reject 근거로는 부족.

**제안**:
1. (현 sprint) findings 에 P3 으로 기록만, sprint-211 PASS 유지.
2. (planner 후속) sprint-N 에서 spec 의 "live in helpers.ts" 표현을 검증할 때, `@vitejs/plugin-react` JSX 거부 같은 기술 제약을 미리 검토하고 5번째 sub-file 허용을 명시하거나 spec text 를 "lives in helpers.ts OR a colocated `.tsx` companion" 로 완화.
3. (architecture lessons) `memory/lessons/` 에 "JSX 가 들어가는 모듈을 `.ts` 로 명시하면 안 된다" lesson 등록 후보.

### F-002 [P3] — `RdbQuickLookBody` 가 entry 의 `firstSelectedId == null` 단축 분기 우회

**관찰**: pre-211 의 god 파일은 RDB 모드에서 `selectedRowIds.size === 0` 이거나 `firstSelectedId >= data.rows.length` 일 때 panel 자체를 unmount (`return null`) 했다. Sprint 211 의 entry (L86-176) 는 RDB 모드에서도 항상 `<RdbQuickLookBody>` 를 mount 하고, RdbQuickLookBody.tsx L80 `if (!row) return null;` 로 자식 컴포넌트 단계에서 null 을 반환한다.

**영향 분석**:
- 외부 동작 동일: parent `<DataGrid />` 의 DOM 트리에는 여전히 panel-related node 가 mount 안 됨 (자식이 null 반환하므로 React 가 빈 fragment 렌더).
- 980-line test L? "renders nothing when out of bounds / empty" 케이스가 그대로 pass (51/51 ✓).
- 단 `<RdbQuickLookBody />` 의 `useState`, `useMemo`, `useCallback` 같은 hook 이 매번 호출되므로 미세하게 추가 비용. 단 panel 자체가 mount 시 비용 없으니 사실상 무영향.

**P3 분류 사유**: 행동 변경 0, 테스트 통과, 회귀 위험 없음. 단지 entry early-return 으로 자식 마운트를 억제하는 미세한 최적화 기회가 남아 있음. 의도라면 그대로, 정리하고 싶으면 후속 sprint 의 minor cleanup.

**제안**: 후속 minor sprint 에서 entry L160-175 에 `if (firstSelectedId == null || firstSelectedId >= props.data.rows.length) return null;` 를 추가해 자식 컴포넌트 마운트 비용을 절약할지 검토. 현 sprint 는 그대로 PASS.

### F-003 [P3] — entry `editing` 상태가 mode 전환 시 reset 되지 않음

**관찰**: entry L88 `const [editing, setEditing] = useState(false);` 는 props.mode 와 독립이다. mode 가 "rdb" → "document" (혹은 그 반대) 로 바뀌어도 `editing` 은 유지된다.

**영향 분석**:
- 단일 컴포넌트 인스턴스 내에서 props.mode 가 dynamic 하게 바뀔 가능성은 현재 callsite (`DataGrid.tsx`, `DocumentDataGrid.tsx`) 에서는 0. 둘 다 mode 를 고정값으로 전달.
- 980-line test 도 mode 전환 케이스를 테스트하지 않음 (51/51 pass 와 무관).
- pre-211 god 파일도 동일 제약을 가졌을 가능성 있음 (test 에 명시된 보장 없음).

**P3 분류 사유**: 행동 변경 0 (pre-211 도 동일). callsite 가 mode 를 절대 dynamic 하게 바꾸지 않으므로 실세계 영향 0. 후속 sprint 에서 invariant 를 명시할지 정도의 제안.

**제안**: 후속 minor sprint 에서 (a) entry 에 `useEffect(() => setEditing(false), [props.mode])` 를 추가해 mode 전환 시 reset 하는 명시적 보장을 둘지, 혹은 (b) test 에서 "mode 는 props 의 lifecycle 동안 고정" 이라는 invariant 를 1줄 주석으로 박아둘지 결정. 현 sprint 는 그대로 PASS.

## Recommended Next Sprint Actions

1. **handoff.md 작성** (sprint-211/handoff.md) — 5 변경 파일 + 6번째 추가 파일 사실 + 12 check exit code + AC-01..05 evidence + F-001/F-002/F-003 link + post-211 baseline (189 files / 2725 tests) 적시.
2. **(선택) Sprint 211 commit** — 사용자가 명시 요청 시. assistant 자동 커밋 금지 (feedback_git_ops 정책).
3. **sprint-212 candidate 1** — `docs/archives/etc/refactoring-candidates.md` §P2 의 다음 god-file 후보 advance. Sprint 211 의 entry-pattern 패턴을 그대로 답습.
4. **sprint-212 candidate 2 (planner protocol 보강)** — F-001 lesson 을 `memory/lessons/` 에 등록 (`spec 에 "live in helpers.ts" 표현이 있을 때 plugin/loader JSX-parse 제약 사전 검토`). spec 작성 시 `JSX-bearing module 은 반드시 .tsx`, `pure-helper module 은 .ts` 분리 의도 명시. 후속 spec author 가 같은 함정 피하도록.
5. **sprint-212 candidate 3 (minor cleanup, optional)** — F-002 의 entry early-return + F-003 의 mode-reset effect. 두 개 모두 행동 변경 0 의 cosmetic refactor, sprint 1 task 로 합칠 수 있음.

---

**Evaluator Summary**: Sprint 211 은 868-line god → 176-line entry + 5 sub-file (= 6 files) 로 분해. **79.7 % 감소**, **980-line test 51/51 pass**, 프로젝트 **2725/2725 pass**, tsc 0건, lint 0건, 새 eslint-disable 0, 외부 import 경로 byte-for-byte 동일, ARIA + 상수 + edit dispatch ordering + dirty-pill + BLOB-viewer + tree-vs-FieldRows 토글 모두 보존. spec literal "FieldRow lives in helpers.ts" 일탈은 `@vitejs/plugin-react` 의 JSX-loader 제약으로 정당화 가능한 P3. **PASS**.
