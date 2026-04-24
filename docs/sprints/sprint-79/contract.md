# Sprint Contract: Sprint 79 — Connection Dialog Layout + Inline Test Feedback Polish

## Summary

- **Goal**: ConnectionDialog 의 footer / 폭 레이아웃을 정리해 "우측 dead band" 인상을 제거하고, 이미 존재하는 inline Test Connection 알림의 시각적 비중/접근성을 회귀 없이 강화한다. 기능적으로는 Test 버튼을 footer 좌측으로 이동하고 모달 폭을 `w-dialog-xs` (440px) → `w-dialog-sm` (480px) 로 승격해 현재 11개 input 필드 (+ MongoDB/Advanced) 에 맞는 시각 여유를 준다. Test Connection 의 에러 / 성공 결과는 이미 inline 으로 표시되고 있으므로 신규 구축이 아니라 **보존 + 접근성 회귀 가드** 가 실제 범위다.
- **Audience**: Generator / Evaluator.
- **Owner**: Harness 오케스트레이터.
- **Verification Profile**: `mixed` (command + 선택적 browser).

## Scope

### In Scope

- `src/components/connection/ConnectionDialog.tsx`:
  - Footer (L574) `justify-end` → `justify-between`. Test Connection 버튼을 footer **좌측** 그룹에 배치, Cancel/Save 는 우측 그룹. 이로써 footer 의 horizontal 공간이 균형 잡힘.
  - 모달 루트 폭 `w-dialog-xs` (L142, L145) → `w-dialog-sm` (480px). 두 곳(DialogContent + inner wrapper) 동시 교체.
  - Test result alert (L542-558) 는 **유지**: `role="alert"` + 성공/에러 아이콘 + success/destructive 색 토큰. 단 명시적 `aria-live="polite"` 보강 (보존적 강화).
  - 선택: Test result 메시지가 매우 길 때 overflow 처리 (`break-words`).
- `src/components/connection/ConnectionDialog.test.tsx`:
  - 레이아웃 회귀 테스트: footer 가 Test 버튼을 좌측에 두는지 (DOM 순서 또는 부모 클래스 assertion).
  - Dialog 폭 회귀 테스트: `w-dialog-sm` 클래스 존재.
  - 기존 AC-06 Test Connection 테스트 (성공/실패/disabled) 전부 통과 유지.

### Out of Scope

- Dialog 내부 폼 필드의 2-column 재레이아웃 (Environment + DB Type side-by-side 등) — 별도 sprint.
- `max-h-[60vh]` → token 교체 — 프로젝트 전반에 `[60vh]`/`[80vh]` 패턴이 있고, 이는 별도 ADR-0008 후속 작업.
- URL-mode 입력 UI 변경.
- MongoDB / Advanced section 내부 구조 변경.
- Tauri / store / types 변경.
- Sprint 74-78 흐름 / 파일 변경.

## Invariants

1. **Test Connection 핸들러 불변**: `handleTest` (L93-104) 의 signature/순서/에러 처리 그대로.
2. **Inline Test result rendering**: success 는 `bg-success/10 text-success` + `CheckCircle`, error 는 `bg-destructive/10 text-destructive` + `AlertCircle`. 색/아이콘 토큰 변경 금지.
3. **Save / Cancel 버튼 동작 불변** — `handleSave` / `onClose`.
4. **URL mode, Password 토글, Advanced Section 동작 변경 없음**.
5. **IPC 계약 안정**: `testConnection` / `addConnection` / `updateConnection` 시그니처 불변.
6. **기존 ConnectionDialog.test.tsx 케이스 (AC-01 ~ AC-07 커버) 전부 통과**.
7. **ADR 0008 토큰 준수** — 신규 arbitrary px 금지. 기존 `max-h-[60vh]` 는 scope 밖이므로 보존.
8. **접근성**: Test Connection 버튼 text label 유지, result alert `role="alert"` + `aria-live="polite"` 추가 허용. Close 버튼 `aria-label="Close dialog"` 유지.
9. **Sprint 74-78 회귀 없음**.
10. **기존 1506+ 테스트 전부 통과**.

## Acceptance Criteria

- **AC-01** — ConnectionDialog 의 footer 는 `justify-between` (또는 동등한 시각 효과) 를 사용해 **Test Connection 을 좌측에**, **Cancel + Save 를 우측에** 배치한다. 사용자가 footer 의 좌측이 비어 보이는 dead-band 인상을 받지 않는다.
- **AC-02** — ConnectionDialog 의 루트 폭이 `w-dialog-sm` (480px) 로 승격된다. `w-dialog-xs` 참조는 전부 제거 (두 곳).
- **AC-03** — Test Connection 인라인 결과 alert 는 기능적으로 동일하게 동작한다:
  - 성공 시 `CheckCircle` + success 톤 + 메시지.
  - 실패 시 `AlertCircle` + destructive 톤 + 메시지.
  - 스크린리더를 위해 `role="alert"` + `aria-live="polite"` 가 부여된다 (신규 `aria-live`; 이는 회귀를 막는 보존적 강화).
- **AC-04** — `handleTest` 핸들러 본문은 변경되지 않는다 (signature, 호출 순서, 상태 업데이트 형태 전부 동일).
- **AC-05** — Sprint 74-78 파일 / 테스트는 손 대지 않는다. 기존 1506+ 테스트 전부 통과.
- **AC-06** — ConnectionDialog.test.tsx 에 아래 신규 테스트가 추가된다:
  - Footer 의 Test Connection 버튼이 Cancel/Save 보다 DOM 순서 상 **먼저** 렌더된다 (또는 좌측 그룹 컨테이너에 속함).
  - Dialog 루트가 `w-dialog-sm` 클래스를 가진다 (폭 토큰 회귀 가드).
  - Test result 성공/실패 alert 가 `aria-live="polite"` 속성을 가진다 (접근성 회귀 가드).
  - 기존 AC-06 스위트 (성공/실패/disabled) 는 건드리지 않고 통과.
- **AC-07** — 게이트: `pnpm tsc --noEmit` 0 errors (Sprint 79 변경 범위), `pnpm lint` 0 warnings, `pnpm vitest run` 전 테스트 통과.

## Design Bar / Quality Bar

- Footer 버튼 간격은 기존 `gap-2` 유지. 좌/우 그룹 구분은 `justify-between` + 좌측 그룹 컨테이너 (`<div>`) 로.
- 폭 변경은 두 개의 `w-dialog-xs` 레퍼런스를 동시에 일관되게 교체. `w-dialog-sm` 이 480px 임을 주석에 명시할 필요는 없음 (토큰이 self-describing).
- `aria-live="polite"` 는 result alert container 에만 부여. 버튼 / 다른 alert 에는 부여 금지.
- 테스트는 RTL `getByRole("button", { name: /test connection/i })` 와 `getByRole("alert")` 사용. `getByTestId` 최소화.
- Sprint 74-78 회귀 가드는 `pnpm vitest run` 전체 실행으로 충분 — 별도 반복 assertion 불필요.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 0 errors (기존 Sprint 83 untracked 에러는 scope 외).
2. `pnpm lint` → 0 warnings/errors.
3. `pnpm vitest run` → 전체 통과.
4. `pnpm vitest run src/components/connection/ConnectionDialog.test.tsx` → 신규/기존 테스트 출력 확인.
5. (선택) 브라우저: 연결 생성/편집 dialog 열어 footer 레이아웃 + width 변경 + Test Connection 흐름 smoke.

### Required Evidence

- Generator `docs/sprints/sprint-79/handoff.md` 에:
  - 변경/추가 파일 목록 + 목적
  - 각 AC → test file:line 매핑
  - 세 게이트 결과 last lines
  - Footer 레이아웃 (좌/우 그룹 구조) 선택 근거
  - Dialog 폭 선택 근거 (sm vs md)
  - 남은 위험 / 갭
- Evaluator 는 각 AC 에 file:line 인용.

## Test Requirements

### Unit Tests (필수)

- 각 AC 에 대응하는 최소 1개 테스트.
- 레이아웃 회귀: footer 버튼 DOM 순서 / 루트 width 클래스.
- 접근성 회귀: Test result alert `aria-live` 속성.

### Coverage Target

- 신규/수정 코드: 라인 70% 이상.

### Scenario Tests (필수)

- [ ] Happy path: Dialog 열기 → Test Connection 클릭 → 성공 alert 표시.
- [ ] 에러: mockReject → 실패 alert 표시.
- [ ] 회귀: Cancel / Save / URL mode / Password 토글 / MongoDB 조건부 필드 / Advanced details 기존 테스트 전부 통과.
- [ ] 경계: 매우 긴 에러 메시지도 alert 내부에서 wrap (`break-words` 적용 시 확인).

## Test Script / Repro Script

1. `pnpm vitest run src/components/connection/ConnectionDialog.test.tsx` — AC-01, AC-02, AC-06.
2. `pnpm vitest run src/components/connection` — 전체 connection 테스트 회귀 (Sprint 78 포함).
3. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run` — 전체 게이트.

## Ownership

- **Generator**: general-purpose agent.
- **Write scope**:
  - `src/components/connection/ConnectionDialog.tsx` (footer + width + aria-live)
  - `src/components/connection/ConnectionDialog.test.tsx`
  - `docs/sprints/sprint-79/handoff.md`
- **Merge order**: Sprint 78 (`2460169`) 이후.

## Exit Criteria

- 오픈된 P1/P2 finding: `0`.
- 필수 검증 통과: `yes`.
- 모든 AC 증거가 `handoff.md` 에 파일:라인 인용.
- Evaluator 각 차원 점수 ≥ 7.0/10.
