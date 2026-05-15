# Sprint Contract: sprint-344 / Slice B — `+ key` inline pair input on object nodes

## Summary

- Goal: 모든 object node (root 포함) 에 `+ key` 어포던스 추가. 클릭 시
  인라인으로 key/value paired input 등장. Tab 으로 두 input 이동,
  Enter commit (Slice D 의 `coerceTreeAddValue` 호출 후 `onCommitEdit`),
  Esc cancel. 빈 key reject, 중복 key reject. Slice A 의 ghost
  renderer 가 commit 직후 NEW row 를 렌더.
- Audience: DocumentTreePanel 사용자 (Mongo + RDB 양쪽 grid).
- Owner: Generator agent
- Verification Profile: `command`

## In Scope

- `DocumentTreePanel.tsx` 의 object node row 끝에 `+ key` 어포던스 (단,
  `onCommitEdit` prop 이 제공될 때만 — read-only mode 호환).
- 클릭 시 두 input 등장 (key + value), 첫 input (key) auto-focus.
- Tab/Shift+Tab — 두 input 사이 이동.
- Enter — Slice D 의 `coerceTreeAddValue(valueInput)` 호출 후
  `onCommitEdit(joinPath(parentPath, keyInput), coerced)`. 두 input 닫힘,
  `+ key` 어포던스 다시 보임.
- Esc — input 닫힘, commit 안 함.
- 빈 key + Enter → aria-invalid + 인라인 메시지 "key required". commit 안 함.
- 중복 key + Enter (`value` 또는 `pendingByPath` 에 이미 존재) → aria-invalid
  + 메시지 "key already exists". commit 안 함.
- Root level (column root) 의 cell value 가 object 일 때도 root 객체 자체에
  `+ key` 가능.
- Path 표기 일관: root key add 시 path = `keyName`. nested key add 시
  path = `parent.keyName` (기존 `joinPath` 사용).

## Out of Scope

- `+ item` (Slice C).
- `coerceTreeAddValue` 헬퍼 자체 (Slice D 에서 완료 — 호출만).
- Generator dispatch — Slice E.
- Grid 통합 — Slice F.
- `_id` 보호 같은 paradigm-specific 규칙 — Slice F 에서 grid-level guard.
- Ghost row 의 시각 표시 변경 (Slice A 의 NEW badge 그대로 사용).
- Array push (Slice C).
- Drag-and-drop key reorder, key rename — out.

## Invariants

- 기존 leaf edit / delete / collapse / search / diff toggle / BSON inline
  editor 동작 100% 유지.
- `DocumentTreePanel` paradigm-agnostic 유지.
- `safeStringifyCell` 사용. raw `JSON.stringify` cell-domain 호출 금지.
- 모든 신규 테스트마다 작성 이유 + `2026-05-15` 코멘트.

## Acceptance Criteria

- `AC-344-B-01` — Object node 의 자식 끝에 `+ key` button 렌더 (단
  `onCommitEdit` 있을 때만). Root object 도 동일.
- `AC-344-B-02` — `+ key` 클릭 시 key input + value input 두 개 등장.
  key input auto-focus, placeholder 표시.
- `AC-344-B-03` — Tab from key input → focus moves to value input.
  Shift+Tab from value input → focus moves back to key input.
- `AC-344-B-04` — Enter from key OR value input → commit. `onCommitEdit`
  exactly 1회 호출. Path = parentPath + keyName (root = bare key).
  Value = Slice D coerced JSON value.
- `AC-344-B-05` — Esc → input 닫힘, `onCommitEdit` 호출 안 됨.
- `AC-344-B-06` — 빈 key + Enter → aria-invalid + 메시지. commit 안 됨.
- `AC-344-B-07` — 중복 key (existing in `value` or `pendingByPath`) + Enter →
  aria-invalid + 메시지. commit 안 됨.
- `AC-344-B-08` — 빈 value + non-empty key + Enter → commit 됨 (사용자 의도
  대로 빈 값 추가).
- `AC-344-B-09` — Commit 후 input 닫힘, `+ key` 어포던스 다시 렌더.
- `AC-344-B-10` — Nested object 안의 nested object 에도 `+ key` 동작 동일.
- `AC-344-B-11` — `coerceTreeAddValue` 의 outer-quotes rule 적용 — value
  `42` (no quotes) → number, `"42"` → string. commit 의 value 가 number
  vs string 인지 단언으로 검증.

## Design Bar / Quality Bar

- Button text: `+ key` (또는 ＋ key, 일관). dashed muted 색.
- Input pair: 같은 indent (parent child indent).
- Validation message: 12px, red-500 (existing token).
- Focus ring: existing primary color outline.
- Accessibility: `role="button"`, `aria-label="Add key to {parent}"`,
  `aria-invalid` when reject, 메시지 `aria-live="polite"`.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` —
   AC-344-B-01 ~ 11 모두 pass.
2. `pnpm vitest run` 전체 — 회귀 0.
3. `pnpm tsc --noEmit` — clean.
4. `pnpm lint` — clean.

### Required Evidence

- Generator must provide:
  - 변경 파일 + 목적
  - 각 AC 매핑 (test 위치)
  - 명령 결과
- Evaluator must cite:
  - 각 AC pass evidence (test it/describe 이름 + 핵심 assertion)
  - 누락된 evidence finding 으로 분류

## Test Requirements

### Unit Tests (필수)
- AC-344-B-01 ~ 11 각각 ≥ 1 case
- Edge: 매우 긴 key 이름, 특수 문자 key, unicode key, 공백만 key, key 가
  `__proto__` (보안)
- 모든 신규 case 에 `2026-05-15` 코멘트

### Coverage Target
- 변경된 DocumentTreePanel.tsx 부분: 라인 70% 이상

### Scenario Tests (필수)
- [ ] Happy path: 객체에 새 key + value 추가, commit
- [ ] 빈 입력: 빈 key reject, 빈 value commit
- [ ] 경계: 중복 key reject, root level, nested level
- [ ] 회귀: 기존 leaf edit / delete / collapse / search / BSON / diff

## Test Script

1. `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose agent
- Write scope: **오직** 다음 두 파일.
  - `src/components/document/DocumentTreePanel.tsx`
  - `src/components/document/DocumentTreePanel.test.tsx`
- Merge order: Slice A/D 가 이미 disk 에 있음. Slice B 변경은 그 위.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- AC evidence linked in `findings-B.md`
