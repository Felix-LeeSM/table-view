# Sprint Execution Brief: Sprint 75 — Empty-input Coercion and Type Validation on Commit

## Objective
비텍스트 컬럼에서 빈 문자열 입력을 `SQL NULL` 로 강제 변환하고, `"1"`/`"t"`/ISO 문자열 같은 사용자 입력을 컬럼 타입에 맞는 SQL 리터럴 (number / boolean / date) 로 직렬화한다. 강제 변환이 불가능할 때는 SQL 을 생성하지 않고 해당 셀 옆에 인라인 validation hint 를 띄운다.

## Task Why
Sprint 74 는 NULL 칩에서 typed editor 로 복귀하는 UX 만 고쳤다. 저장 단계는 여전히 모든 값을 `'...'` 로 싱글-쿼트 감싸서 직렬화한다 — 정수 컬럼에 `SET age = '42'` 가 나가 PostgreSQL 이 `invalid input syntax for type integer` 를 던지고, `SET flag = ''` 가 boolean 컬럼에 나가면 에러가 난다. 사용자가 빈 입력으로 NULL 을 의도하는 기대와도 어긋난다. 결과적으로 현재 Table View 는 정수/boolean/date 셀을 TablePlus-like 방식으로 안전하게 편집할 수 없다.

## Scope Boundary
- **범위 안**: UPDATE + INSERT 경로의 literal emit 분기, 커밋 시 validation gate, 에러 entry 를 수용하는 훅 상태, 활성 편집 셀의 인라인 hint 렌더.
- **범위 밖**: boolean 용 select UI (Sprint 74+의 `<input type="text">` 유지), backend(Rust) validation, sort 상태 (Sprint 76), 탭 동작 (Sprint 77).

## Invariants
1. ADR 0009 tri-state — textual column `''` 은 여전히 `''`, `null` 은 `NULL`.
2. Sprint 74 NULL 칩 → typed editor 분기 동작 유지.
3. SQL preview = commit payload (validation 으로 빠진 셀은 양쪽 모두에서 제외).
4. 기존 1288 테스트 전부 통과.
5. `editorFocusRef` 포커스 관리 (2026-04-24 lesson) 유지.
6. `any` 신규 금지, ADR 0008 토큰만 사용, dark mode 가시성 유지.

## Done Criteria
1. `sqlGenerator.generateSql` 이 `column.data_type` 을 읽어 UPDATE 리터럴을 분기한다: textual 은 `''` 유지, 비텍스트는 빈 문자열 → `NULL`.
2. 타입별 리터럴 포맷: integer/numeric → 인용 없음, boolean → `TRUE`/`FALSE`, date/timestamp/time/uuid → 인용 유지, text → 기존 escape.
3. Commit 단계에서 type coerce 실패한 pending edit 은 SQL 에서 제외되고, 훅 내부 에러 맵에 `{ rowKey, colKey, message }` 엔트리가 남는다.
4. `DataGridTable` 이 활성 편집 셀에 에러가 있을 때 `text-destructive` 기반 인라인 hint 를 렌더하고, 입력 변경 시 해당 에러 엔트리가 지워진다.
5. `sqlGenerator.test.ts` + `useDataGridEdit.*.test.ts` + `DataGridTable.*.test.tsx` 에 각 타입 분기 / 실패 케이스 / hint 가시성 테스트 추가.

## Verification Plan
- **Profile**: mixed (command + browser)
- **Required checks**:
  1. `pnpm tsc --noEmit` → 에러 0
  2. `pnpm lint` → 에러/경고 0
  3. `pnpm vitest run` → 기존 1288 + 신규 전부 통과
  4. `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts` 출력에 각 타입 분기 테스트 명 확인
  5. (선택) 브라우저에서 integer 컬럼 `abc` 입력 → commit → hint → 입력 수정 → hint 사라짐
- **Required evidence**:
  - 변경/추가 파일 목록 + 목적
  - 각 AC 별 테스트 file:line 매핑
  - 세 게이트 출력 마지막 몇 줄
  - validation 규칙에 대한 명시적 가정 (boolean literal accept set, date format accept set 등)

## Evidence To Return
- 변경/추가 파일 목록 (path: 목적)
- 실행한 세 검증 명령 + 결과
- 각 Done Criterion 별 evidence (test 파일 + 라인 번호)
- Helper 시그니처 (예: `coerceToSqlLiteral(value: string | null, dataType: string): { kind: "sql"; sql: string } | { kind: "error"; message: string }` — 최종 시그니처는 Generator 재량)
- 구현 중 한 가정 (예: numeric 공백 허용 여부, boolean 한국어 허용 여부)
- 남은 위험/갭 (예: 브라우저 smoke 미실행)

## References
- **Contract**: `docs/sprints/sprint-75/contract.md`
- **Master spec**: `docs/sprints/sprint-74/spec.md` — Sprint 75 섹션
- **Relevant files**:
  - `src/components/datagrid/sqlGenerator.ts` — literal emit 분기 (현재 57, 80 줄 근처)
  - `src/components/datagrid/sqlGenerator.test.ts` — 분기별 테스트 추가 대상
  - `src/components/datagrid/useDataGridEdit.ts` — commit 경로 + 에러 맵 도입
  - `src/components/datagrid/DataGridTable.tsx` — 활성 에디터 아래 hint 렌더
  - ADR 0009 (`memory/decisions/0009-null-vs-empty-string-tri-state/memory.md`)
  - Lesson 2026-04-24 (`memory/lessons/2026-04-24-react-autofocus-form-control-only/memory.md`)
  - Sprint 74 handoff — typed editor 분류 기준 재사용 가능 (`docs/sprints/sprint-74/handoff.md`)
