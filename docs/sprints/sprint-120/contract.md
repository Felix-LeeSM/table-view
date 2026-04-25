# Sprint Contract: sprint-120 — 폴더 재조직 (paradigm-specific viewer foundation)

## Summary

- **Goal**: `src/components/{rdb,document}/` 폴더 신설 + 기존 RDB/Mongo 컴포넌트를 해당 폴더로 이동 (rename only). 컴포넌트 내부 코드 0 변경. 미래 paradigm 추가 시 누락을 컴파일 타임에 잡을 `assertNever` 가드 도입.
- **Audience**: Frontend (React/TypeScript)
- **Owner**: Generator (sprint-120)
- **Verification Profile**: `command`

## In Scope

- 폴더 신설:
  - `src/components/rdb/` (NEW)
  - `src/components/document/` (이미 존재 — 모달들이 살고 있음, 추가 파일만 들어옴)
- 파일 이동 (git rename):
  - `src/components/DataGrid.tsx` → `src/components/rdb/DataGrid.tsx`
  - `src/components/DataGrid.test.tsx` → `src/components/rdb/DataGrid.test.tsx`
  - `src/components/FilterBar.tsx` → `src/components/rdb/FilterBar.tsx`
  - `src/components/FilterBar.test.tsx` → `src/components/rdb/FilterBar.test.tsx`
  - `src/components/DocumentDataGrid.tsx` → `src/components/document/DocumentDataGrid.tsx`
  - `src/components/DocumentDataGrid.test.tsx` → `src/components/document/DocumentDataGrid.test.tsx`
- import 경로 업데이트 (consumer ~ 6-8 곳):
  - `src/components/layout/MainArea.tsx`
  - `src/components/layout/TabBar.tsx` (간접적으로 영향 가능 시)
  - 모든 테스트 파일에서 위 컴포넌트 import 하는 곳
  - 동적 import / lazy() 형태가 있다면 별도 grep 으로 잡기
- 신규 파일:
  - `src/lib/paradigm.ts`: `Paradigm` re-export + `assertNever(p: never): never` 유틸
  - `src/lib/paradigm.test.ts`: `assertNever` 단위 테스트 (1-2 개)

## Out of Scope

- 컴포넌트 내부 코드 (JSX, hook 호출, prop signature) 변경 — 0 줄 변경
- 신규 paradigm-specific 컴포넌트 (DocumentFilterBar 등)
- `useDataGridEdit.ts` 의 paradigm fork 변경
- `MainArea.tsx` 의 paradigm 분기 로직 변경 (단 import 경로는 업데이트)
- 새 paradigm (search/kv) 의 placeholder UI

## Invariants

- `src-tauri/**` byte-identical (diff 0)
- `src/components/datagrid/useDataGridEdit.ts` byte-identical (Sprint 86 결정 보존)
- 모든 컴포넌트의 *내용물* (rename 대상 6 파일) byte-identical — 변경은 import 라인 (consumer 측) 뿐
- Vitest baseline (Sprint 87 기준 1615) 동일하게 유지 — 신규 테스트는 `paradigm.test.ts` 의 1-2 개만 (오차 허용)
- `pnpm tsc --noEmit` + `pnpm lint` 0 errors

## Acceptance Criteria

- `AC-01`: rename 후 모든 import 가 새 경로로 갱신; `pnpm tsc --noEmit` 통과
- `AC-02`: `pnpm lint` 0 errors, `pnpm vitest run` baseline ± `paradigm.test.ts` 신규 테스트 (1-2 개)
- `AC-03`: rename 으로 인한 코드 *내용물 변경* 0 — `git diff -M --stat HEAD~1 HEAD` 가 rename detection 으로 표시되고, content diff 는 import 경로 라인뿐임을 캡처 (rename 대상 6 파일에 대해)
- `AC-04`: `src/lib/paradigm.ts` 가 `assertNever(p: never): never` 를 export; `MainArea.tsx` 의 paradigm 분기 끝에 `assertNever(tab.paradigm)` 호출하여 미래 paradigm 누락이 컴파일 타임에 검출되도록 함
- `AC-05`: `git diff --stat HEAD -- src-tauri/` empty
- `AC-06`: `git diff --stat HEAD -- src/components/datagrid/useDataGridEdit.ts` empty (Sprint 86 보존)
- `AC-07`: 동적 import 또는 lazy import 가 있다면 모두 새 경로로 갱신 (grep 으로 검증)

## Design Bar / Quality Bar

- rename 작업이라 "코드 품질 리뷰" 는 비대상. 핵심은 *완전성* — 한 import 라도 누락되면 빌드 실패.
- `assertNever` 가드는 Phase 7 capability adapter 진화 시 분기 누락을 컴파일 타임에 잡는 도구로 활용. 도입 위치는 *최소 1곳* (`MainArea.tsx`) 이지만, paradigm 분기를 가진 다른 곳 (`QueryTab.tsx`, `QueryEditor.tsx`, `SchemaPanel.tsx` 등) 으로의 확산은 sprint 121+ 에서 점진 도입 가능.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 0 errors
2. `pnpm lint` → 0 errors
3. `pnpm vitest run` → 모든 테스트 통과; baseline 유지 (신규 paradigm.test.ts 1-2 개 외)
4. `git diff -M --stat HEAD~1 HEAD` → rename 6 파일이 R(name) 마크로 표시; content diff 는 import 라인뿐
5. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts` → empty
6. `grep -r "from \"@/components/(DataGrid|FilterBar|DocumentDataGrid)\"" src/` → 0 매치 (옛 경로 import 남지 않음)

### Required Evidence

- Generator must provide:
  - rename 6 파일 + 새 경로 명시
  - import 업데이트한 consumer 파일 목록 + 라인 번호
  - `src/lib/paradigm.ts` 의 `assertNever` 시그니처 + 테스트 케이스 수
  - `MainArea.tsx` 의 `assertNever` 호출 위치 (file:line)
  - 6 check 의 실행 결과 (수치/빈 출력 캡처)
- Evaluator must cite:
  - 각 AC 별 통과 증거 (file:line 또는 명령 출력)
  - import 누락 / 경로 오류 / 테스트 회귀 등 발견 사항

## Test Requirements

### Unit Tests (필수)
- `src/lib/paradigm.test.ts`: `assertNever` 가 알 수 없는 paradigm 값에 대해 throw 또는 컴파일 에러 유도하는지 검증 (1-2 케이스 충분)

### Coverage Target
- 신규 코드 (`src/lib/paradigm.ts`): 라인 100% (작은 파일)
- CI 전체 baseline 유지

### Scenario Tests
- [x] Happy path: rename 후 모든 기존 테스트 통과
- [x] 에러: import 경로 누락 시 tsc 가 잡음 (실패 시나리오는 자동 검증)
- [x] 회귀 없음: vitest baseline 동일

## Test Script / Repro Script

1. `git mv src/components/DataGrid.tsx src/components/rdb/DataGrid.tsx` (및 짝 5 파일)
2. `grep -rn "from \"@/components/\\(DataGrid\\|FilterBar\\|DocumentDataGrid\\)\"" src/` 결과를 sed/edit 로 새 경로로 치환
3. `src/lib/paradigm.ts` 작성 + `MainArea.tsx` 의 paradigm 분기 끝에 `assertNever(tab.paradigm)` 추가
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
5. `git diff -M --stat HEAD` 로 rename 검증

## Ownership

- **Generator**: sprint-120 generator
- **Write scope**: rename 6 파일 + import 업데이트 ~8 파일 + 신규 2 파일 (`paradigm.ts`, `paradigm.test.ts`) + `MainArea.tsx` 1 라인 추가
- **Merge order**: sprint-120 → 121 → 122 → 123 (선형 chain)

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- 다음 sprint (121) 가 새 폴더 구조 위에서 시작 가능
