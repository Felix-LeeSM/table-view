# Sprint Execution Brief: sprint-94

## Objective

전역 toast 시스템 (success/error/info/warning + dismiss) 을 도입하고 commit + connection CRUD 성공/실패 사이트에 hookup.

## Task Why

P1 사용자 리포트 (#FB-1). commit 성공/실패, connection CRUD 등이 조용히 일어나 사용자 피드백 부재. sprint-93 의 commitError 도 모달 닫으면 사라져 추가 알림 필요.

## Scope Boundary

**쓰기 허용**:
- `src/components/ui/toaster.tsx` (신규)
- `src/lib/toast.ts` (신규)
- `src/App.tsx` (mount)
- `src/components/datagrid/useDataGridEdit.ts` (commit hookup)
- `src/components/connection/ConnectionDialog.tsx` 또는 `src/stores/connectionStore.ts` (CRUD hookup)
- `src/components/ui/toaster.test.tsx` (신규)
- `src/lib/toast.test.ts` (신규, 선택)
- 기존 사이트의 test 파일 (toast 호출 단언 추가)

**쓰기 금지**:
- 다른 컴포넌트, 다른 다이얼로그
- sprint-88~93 산출물
- `CLAUDE.md`, `memory/`, `package.json` (sonner 추가 시 예외 — 이 경우 결정 근거 명시)

## Invariants

- 기존 테스트 회귀 0
- commit / connection 액션 시그니처 변경 0
- 토스트 미사용 path 동작 변화 없음

## Done Criteria

1. `toast.success/error/info/warning/dismiss` API 존재.
2. App.tsx 가 toaster 컨테이너 마운트.
3. commit (success/partial/single failure) hookup.
4. connection CRUD success hookup.
5. role=status/alert + Esc dismiss + dismiss `aria-label`.
6. 신규 테스트 + 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. grep toast API + role 단언
  5. grep hookup 사이트

## Evidence To Return

- 변경 파일 + 목적
- 명령 출력 + AC 별 라인 인용
- hookup 사이트 표
- 외부 lib 도입 결정 (sonner 등) 시 근거
- 가정/위험

## Untouched Working Tree

이전과 동일 — 만약 `memory/` 변경 보이면 건드리지 마라.

## References

- Contract: `docs/sprints/sprint-94/contract.md`
- Spec: `docs/sprints/sprint-94/spec.md`
- 기존 commit 위치: `src/components/datagrid/useDataGridEdit.ts:680~712` (sprint-93 catch 블록 영역)
- Connection store: `src/stores/connectionStore.ts` (addConnection/updateConnection/deleteConnection)
