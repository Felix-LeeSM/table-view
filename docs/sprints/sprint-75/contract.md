# Sprint Contract: Sprint 75 — Empty-input Coercion and Type Validation on Commit

## Summary

- **Goal**: 비텍스트 컬럼에서 빈 문자열을 저장하면 `SET col = NULL` 이 생성되고, 커밋 경로가 `"1"` → 정수, `"t"/"true"/"1"` → boolean, ISO 문자열 → 날짜/타임스탬프 리터럴로 강제 변환한다. 강제 변환 실패 시 해당 셀 옆에 인라인 hint를 띄우고, SQL은 생성하지 않는다.
- **Audience**: Generator / Evaluator 에이전트 및 리뷰어.
- **Owner**: Harness 오케스트레이터.
- **Verification Profile**: `mixed` (command + browser)

## In Scope

- `src/components/datagrid/sqlGenerator.ts` — UPDATE + INSERT 리터럴 방출 규칙을 컬럼 data_type 기반으로 분기.
- `src/components/datagrid/useDataGridEdit.ts` — 커밋 시 type validation gate. 실패한 pending edit은 SQL 생성에서 제외하고, 셀 좌표별 에러 메시지를 에러 맵에 기록.
- `src/components/datagrid/DataGridTable.tsx` — 활성 에디터 아래 (또는 인접) 영역에 type-error hint 렌더.
- `src/components/datagrid/sqlGenerator.test.ts` — 각 타입 분기 커버리지.
- 신규 또는 기존 `useDataGridEdit.*.test.ts` — validation failure 경로 테스트.
- 신규 또는 기존 `DataGridTable.*.test.tsx` — 인라인 hint 렌더 가시성 테스트.

## Out of Scope

- Boolean / date 컬럼을 위한 커스텀 select / picker UI 컴포넌트 (다음 스프린트에서 다룸, 일단은 Sprint 74에서 깔린 `<input type>` 로 진행).
- 서버 사이드 (Rust) validation — IPC 경로는 변경하지 않는다.
- 탭 단위 sort 상태 (Sprint 76).
- 커밋 실패 후 롤백 모델 변경 — 현재 `clearError` / `saveCurrentEdit` 흐름을 유지.

## Invariants

1. **ADR 0009 tri-state**: textual column (text/varchar/char/citext/string/json/jsonb) 의 빈 문자열은 여전히 `''` 로 직렬화되며, `null` 은 `NULL` 로 유지.
2. **Sprint 74 typed editor**: NULL 칩에서 printable key 로 재진입할 때 선택되는 input 타입은 바뀌지 않는다.
3. **SQL preview = commit payload**: 오케스트레이터가 보는 SQL preview 와 실제 commit 단계 전송 SQL 이 일치해야 한다 (validation 에러로 제외된 셀은 양쪽 모두에서 빠짐).
4. **기존 테스트 1288개 전부 통과**.
5. **에디터 포커스 관리**: 활성 셀이 validation 오류를 가진 경우에도 `editorFocusRef` 기반 포커스 유지 (ADR — 2026-04-24 lesson).
6. **ESLint / TS strict**: `any` 신규 도입 금지, non-null assertion 신규 도입 금지.

## Acceptance Criteria

- **AC-01** — `sqlGenerator.generateSql` 가 컬럼 `data_type` 을 참조해 UPDATE 절을 방출한다:
  - 빈 문자열 + 비텍스트 타입 (`integer`, `numeric`, `boolean`, `date`, `timestamp`, `time`, `uuid`, `real`, `double precision`, 등) → `SET col = NULL`.
  - 빈 문자열 + 텍스트 타입 (`text`, `varchar`, `char`, `citext`, `string`, `json`, `jsonb`) → `SET col = ''` (Sprint 73 동작 유지).
  - `null` 값은 타입 불문 `SET col = NULL`.
- **AC-02** — 타입별 리터럴 포맷:
  - `integer` / `bigint` / `smallint` / `serial` 계열 + `"42"` → `SET col = 42` (인용 없음).
  - `numeric` / `decimal` / `float` / `double precision` / `real` + `"3.14"` / `"-1"` / `".5"` → 인용 없이 방출.
  - `boolean` / `bool` + `"true"/"t"/"1"` → `TRUE`, `"false"/"f"/"0"` → `FALSE` (대소문자 무시).
  - `date` + ISO date (`YYYY-MM-DD`) → `SET col = 'YYYY-MM-DD'` (인용 유지).
  - `timestamp` / `timestamptz` / `datetime` + ISO datetime → 인용된 리터럴.
  - `time` + `HH:MM` 또는 `HH:MM:SS` → 인용된 리터럴.
  - `uuid` + 표준 36자 UUID → 인용된 리터럴.
  - 텍스트 타입은 기존 동작 (싱글-쿼트 escape `O''Brien`).
- **AC-03** — 강제 변환 실패 시 해당 pending edit 은 SQL 생성에서 **빠지고**, 훅 상태에 셀별 에러 엔트리가 남는다. 예:
  - `integer` + `"abc"` → SQL 없음, 에러 메시지 (e.g. `"Expected integer"`).
  - `boolean` + `"maybe"` → SQL 없음, 에러 메시지.
  - `date` + `"yesterday"` → SQL 없음, 에러 메시지.
  - 같은 배치의 다른 유효한 edit 은 영향받지 않음.
- **AC-04** — `DataGridTable` 이 활성 편집 셀에 에러 엔트리가 있을 때 인라인 hint 를 렌더한다 (e.g. editor 바로 아래 `text-destructive` 또는 유사 muted-destructive 토큰). 편집기는 열린 상태를 유지하고, 사용자가 입력을 바꾸면 hint 는 지워진다.
- **AC-05** — 단위 테스트 커버리지:
  - `sqlGenerator.test.ts`: AC-01/AC-02 의 각 타입 분기 (integer / numeric / boolean / date / timestamp / time / uuid / text + textual-empty-preserve).
  - `useDataGridEdit.*.test.ts`: 성공 commit 시 유효 edit 의 pending 맵 반영 + 실패 edit 의 에러 맵 반영 + 두 케이스가 한 배치에 있을 때 독립성.
  - `DataGridTable.*.test.tsx`: 에러 상태에서 hint 텍스트가 DOM 에 있고, 입력 변경 시 사라진다.

## Design Bar / Quality Bar

- 에러 메시지는 사용자에게 읽히는 문장 (예: `"정수 값을 입력하세요"`, `"Expected boolean"` — 현재 프로젝트 copy 톤에 맞춰 영문/한글 선택 가능, 다만 일관성 유지).
- hint 는 `role="alert"` 또는 `aria-live="polite"` 로 스크린리더 접근 가능.
- Tailwind 토큰만 사용 (`text-destructive`, `bg-destructive/10` 등 — `text-red-500` 같은 raw 색 금지, ADR 0008).
- dark mode 에서도 hint 가시성 유지.
- validation 판정은 순수 함수로 추출 (테스트 가능, 재사용 가능). `sqlGenerator.ts` 내부 helper 또는 신규 모듈에 위치.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` → 에러 0.
2. `pnpm lint` → 에러/경고 0.
3. `pnpm vitest run` → 70+ 파일, 1288+ 기존 + Sprint 75 신규 케이스 전부 통과.
4. `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts` 의 출력이 AC-01 / AC-02 각 분기에 해당하는 테스트명을 포함하는지 확인.
5. (선택, Generator 가 Tauri dev 에 접근 가능할 때만) 브라우저에서 integer 컬럼 편집 → `abc` 입력 → Commit → hint 노출 → 입력 수정 → hint 사라짐.

### Required Evidence

- Generator 는 `docs/sprints/sprint-75/handoff.md` 에:
  - 변경/추가된 파일 + 목적 리스트
  - 각 AC 별 테스트 파일 + 라인 번호 매핑
  - 3개 command gate 결과 마지막 몇 줄
  - 강제 변환 규칙에 대한 명시적 가정 (예: `numeric` 공백 허용 여부, boolean 한국어 허용 여부)
  - 남은 위험 / 다음 스프린트로 넘길 항목
- Evaluator 는 AC 별 pass/fail 를 테스트 파일:라인 또는 helper 시그니처 file:line 으로 인용.

## Test Requirements

### Unit Tests (필수)
- 각 AC 에 대응하는 최소 1개 테스트 (특히 AC-02 는 각 타입 분기별 1개 이상).
- 에러 케이스: 각 타입의 invalid literal 에 대해 최소 1개씩.

### Coverage Target
- 신규/수정 코드: 라인 70% 이상.
- `sqlGenerator.ts` 는 모든 public branch cover (integer / numeric / boolean / date / timestamp / time / uuid / text / textual-empty).

### Scenario Tests (필수)
- [ ] Happy path: textual `''` 유지 + 비텍스트 `''` → NULL + `"1"` → integer literal.
- [ ] 에러: invalid literal → SQL 없음 + 에러 엔트리 존재.
- [ ] 경계: 한 배치에 유효/무효 edit 이 섞였을 때 유효한 것만 SQL 방출.
- [ ] 회귀: Sprint 74 NULL 칩 경로, ADR 0009 tri-state, 기존 `O''Brien` escape.

## Test Script / Repro Script

1. `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts` — AC-01/AC-02 확인.
2. `pnpm vitest run src/components/datagrid/useDataGridEdit` — AC-03 (validation gate) 확인.
3. `pnpm vitest run src/components/datagrid/DataGridTable` — AC-04 (인라인 hint) 확인.
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run` — 게이트 통과.

## Ownership

- **Generator**: general-purpose agent.
- **Write scope**: `src/components/datagrid/{sqlGenerator.ts, useDataGridEdit.ts, DataGridTable.tsx}`, 관련 테스트 파일, `docs/sprints/sprint-75/handoff.md`.
- **Merge order**: Sprint 74 (551ca0f) 이후. Sprint 75 가 Sprint 76/77/78/79 의 foundation 이 된다 (UI 훅 타입).

## Exit Criteria

- 오픈된 P1/P2 finding: `0`.
- 필수 검증 통과: `yes`.
- 모든 AC 증거가 `handoff.md` 에 파일:라인으로 링크됨.
- Evaluator 각 차원 점수 ≥ 7.0/10.
