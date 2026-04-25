# Sprint Contract: sprint-94

## Summary

- Goal: 전역 토스트 시스템을 도입해 commit 성공/실패, connection CRUD 성공/실패 등 silent 이벤트를 일관된 알림으로 노출. SQL Preview 모달이 닫혀도 실패 토스트는 화면에 남는다.
- Audience: Generator + Evaluator
- Owner: Generator
- Verification Profile: `command` (jsdom + RTL — 토스트 노출/dismiss/role 단언). browser 검증은 후속.

## In Scope

- `src/components/ui/toaster.tsx` (신규): 토스트 컨테이너 + 마운트 슬롯. 토스트 큐(`success | error | info | warning`).
- `src/lib/toast.ts` (신규): 호출 API — `toast.success(msg)`, `toast.error(msg)`, `toast.info(msg)`, `toast.warning(msg)`. dismiss API 포함.
- `src/App.tsx`: toaster 마운트.
- 호출처:
  - `src/components/datagrid/useDataGridEdit.ts`: commit 성공 / 부분 실패 / 단일 실패 시 toast.
  - `src/components/connection/ConnectionDialog.tsx` 또는 `src/stores/connectionStore.ts`: 연결 추가/수정/삭제 성공 시 toast.
- `src/components/ui/toaster.test.tsx` (신규): 토스트 API + 컨테이너 단언.

## Out of Scope

- 외부 라이브러리 도입 (sonner 등) 보류 — 자체 구현 권장. 단, Generator 가 `pnpm add sonner` 로 도입해도 무방하나 lock-in 명시.
- 다른 다이얼로그 hookup (Group, Import/Export, Schema 등).
- 모바일/스크린 리더 외 접근성 디테일.

## Invariants

- 기존 happy-path 테스트 회귀 0.
- commit/connection 액션 시그니처 변경 0 (단순 toast 추가만).
- `CLAUDE.md`, `memory/` 변경 0.
- sprint-88~93 산출물 변경 0.

## Acceptance Criteria

- `AC-01` 토스트 API (`toast.success/error/info/warning` + `toast.dismiss`) 가 어디서나 호출 가능. 단언 위치: `toaster.test.tsx`.
- `AC-02` Cmd+S commit 성공 시 success toast, 실패 시 error toast 노출. 부분 실패 시 error toast 메시지에 "executed: N, failed at: K" 정보 포함.
- `AC-03` 실패 토스트는 SQL Preview 모달이 닫혀도 화면에 남음 — 토스트 컨테이너는 modal portal 외부에 마운트.
- `AC-04` 연결 추가/수정/삭제 성공 시 toast 표시.
- `AC-05` 토스트는 Esc 로 닫히고 `role="status"` (info/success) 또는 `role="alert"` (error/warning) 사용. dismiss 버튼 `aria-label` 명시.
- `AC-06` 기존 테스트 회귀 0.

## Design Bar / Quality Bar

- 자체 구현 시 Zustand store 권장 (`useToastStore`). queue + 자동 dismiss timeout (예: success 3s, error 5s, error sticky 옵션).
- Toast 컨테이너 위치: 화면 우상단 또는 우하단 (디자인 보수적). z-index 는 dialog overlay 보다 높게.
- 텍스트만 받는 simple variant + 옵션(action 버튼) 변형까지는 권장하지 않음. 텍스트 + variant + dismiss.
- React 19 + TS strict 호환. test 시 timer mock 가능하도록 `vi.useFakeTimers` 친화적 구조.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 0 failures.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `grep -n "toast.success\|toast.error\|role=\"status\"\|role=\"alert\"" src/lib/toast.ts src/components/ui/toaster.tsx` — 1+ 라인.
5. `grep -rn "toast.success\|toast.error" src/components/datagrid src/components/connection src/stores` — hookup 사이트 검출.

### Required Evidence

- Generator: 변경 파일 + 명령 출력 + AC 별 라인 인용 + hookup 사이트 표.
- Evaluator: AC 별 라인 인용 + 회귀 0 검증.

## Test Requirements

### Unit Tests (필수)
- toast API 호출 시 컨테이너에 토스트 노출 ≥ 1.
- variant 별 role 단언 (success/info → status, error/warning → alert) ≥ 1.
- Esc 키 dismiss 단언 ≥ 1.
- timer 만료 자동 dismiss ≥ 1 (`vi.useFakeTimers`).
- commit 성공/실패 hookup integration (mock toast 호출 단언) ≥ 1.

### Coverage Target
- 신규 코드 라인 70%+.

### Scenario Tests (필수)
- [x] Happy path: success toast 노출 + 자동 dismiss
- [x] 에러: error toast 노출 + sticky 또는 manual dismiss
- [x] 동시: 여러 토스트 큐잉
- [x] commit 실패: 부분 실패 메시지 포함
- [x] 회귀 없음

## Test Script / Repro Script

1. `pnpm vitest run -- toaster ConnectionDialog useDataGridEdit`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`

## Ownership

- Generator: 단일 agent.
- Write scope: contract In Scope 만.
- Merge order: 단일 PR.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `findings.md`
