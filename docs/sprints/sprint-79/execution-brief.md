# Sprint Execution Brief: Sprint 79 — Connection Dialog Layout + Inline Test Feedback Polish

## Objective

ConnectionDialog 의 footer 레이아웃과 모달 폭을 정리해 "우측 dead band" 인상을 제거하고, 이미 존재하는 inline Test Connection 결과 alert 의 접근성을 회귀 없이 보강한다.

## Task Why

스카우트 결과: Test Connection 결과는 **이미 inline 으로 렌더되고** (`ConnectionDialog.tsx:542-558`) 테스트가 커버한다 (`ConnectionDialog.test.tsx:229-273`). 따라서 "Test 결과가 안 보인다" 는 기능 버그가 아니라 **시각 비중** 문제. 반면 footer (`L574`) 는 `justify-end` 로 Test + Cancel + Save 가 **전부 우측** 에 모여 있어 좌측이 비어 보이고, 440px (`w-dialog-xs`) 모달은 11개 폼 필드 + MongoDB/Advanced section 을 담기에 협소해 "우측 dead band" 의 시각적 원인이 된다. 본 스프린트는 footer 좌측 그룹 + 폭 480px 승격 + alert `aria-live` 보강의 세 가지 미세 조정.

## Scope Boundary

- **범위 안**: ConnectionDialog footer `justify-between`, root `w-dialog-sm`, inline Test result `aria-live="polite"`, 회귀 테스트.
- **범위 밖**: 폼 필드 2-column 재레이아웃, `max-h-[60vh]` 토큰 교체, URL mode/Password/MongoDB/Advanced 내부 UI, store/types/IPC, Sprint 74-78 파일.

## Invariants

1. `handleTest` / `handleSave` / `handleDbTypeChange` 본문 불변.
2. Test result 색 · 아이콘 토큰 불변 (`success`/`destructive`, `CheckCircle`/`AlertCircle`).
3. IPC 계약 불변: `testConnection`/`addConnection`/`updateConnection` signature.
4. ADR 0008 — 신규 arbitrary px 금지. 기존 `max-h-[60vh]` 는 scope 밖.
5. Dark mode 가시성 유지.
6. 접근성: `role="alert"` + 신규 `aria-live="polite"` 보존적 추가 허용.
7. Sprint 74-78 회귀 없음.
8. 기존 1506+ 테스트 통과.

## Done Criteria

1. ConnectionDialog footer: Test 버튼 좌측 / Cancel+Save 우측 (`justify-between`).
2. Root 폭 `w-dialog-xs` → `w-dialog-sm` (두 곳 동시 교체, L142 + L145).
3. Inline Test result alert 에 `aria-live="polite"` 추가 (L542-558 컨테이너).
4. ConnectionDialog.test.tsx 에 footer 순서 / width / aria-live 회귀 테스트 추가.
5. 기존 AC-06 (Test Connection 성공/실패/disabled) 테스트는 수정 없이 통과.
6. Sprint 78 ConnectionGroup/ConnectionItem/ConnectionList/Sidebar 회귀 없음.

## Verification Plan

- **Profile**: mixed (command + 선택적 browser)
- **Required checks**:
  1. `pnpm tsc --noEmit` — 0 errors (Sprint 83 untracked 에러는 scope 외).
  2. `pnpm lint` — 0 warnings/errors.
  3. `pnpm vitest run` — 전체 1506+ 통과.
  4. `pnpm vitest run src/components/connection/ConnectionDialog.test.tsx` — 신규 테스트 케이스 출력.
  5. (선택) 브라우저: New Connection dialog 열어 footer 레이아웃, 폭, Test Connection 흐름 smoke.
- **Required evidence**:
  - 변경/추가 파일 목록 + 목적
  - 각 AC → test file:line
  - 세 게이트 last lines
  - Footer 버튼 그룹 구조 (좌/우 div 분할 vs flex 정렬) 선택 근거
  - Dialog width 선택 근거 (sm = 480px 가 현재 11개 필드에 적합하다는 추론)

## Evidence To Return

- 변경/추가 파일 목록 (path: 목적)
- 실행 검증 명령 + 결과
- 각 AC 별 test file:line
- Footer / width / aria-live 각 변경의 미세 근거
- 남은 위험 / 갭

## References

- **Contract**: `docs/sprints/sprint-79/contract.md`
- **Master spec**: `docs/sprints/sprint-74/spec.md` — Sprint 79 섹션
- **Relevant files**:
  - `src/components/connection/ConnectionDialog.tsx:142, 145` — root width class
  - `src/components/connection/ConnectionDialog.tsx:542-558` — inline Test result alert
  - `src/components/connection/ConnectionDialog.tsx:574` — footer `justify-end`
  - `src/components/connection/ConnectionDialog.test.tsx:229-273` — 기존 AC-06 스위트
  - `src/index.css:58-62` — `--spacing-dialog-xs/sm/md/lg/xl` 토큰 정의
- **Prior sprints**: 74 (551ca0f), 75 (7698276), 76 (c6ed688), 77 (dfca43f), 78 (2460169)
