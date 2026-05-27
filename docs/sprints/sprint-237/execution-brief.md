# Sprint Execution Brief: sprint-237

## Objective

- Close Column MODIFY — add USING cast expression to `ColumnChange::Modify`
  (backend + TS mirror + SQL emitter + `ColumnsEditor` UI), add a
  pre-execution NULL-rows conflict probe for SET NOT NULL toggles, and
  record the Phase 27 closure markers (`docs/archives/incidents/`, `docs/PLAN.md`,
  `docs/archives/roadmaps/memory-roadmap/memory.md`).

## Task Why

- Phase 27 = TablePlus 패리티 7단계의 마지막 영역. Sprint 237 종료는 곧
  **TablePlus `working-with-table` 패리티 달성 마일스톤** — 이후 Phase 17–20
  (MySQL / MariaDB / SQLite / Oracle) 재개 평가의 트리거가 된다. 본 sprint
  이후의 closure marker (회고 1편 + PLAN status flip + roadmap row 갱신) 가
  공식 마일스톤 기록.
- 기능적으로는 Column MODIFY 의 두 실용 gap 을 닫는다: (1) PG 가 implicit
  cast 못 하는 타입 변경에서 USING 표현식이 없으면 사용자가 SQL Editor 로
  탈출해야 하는 시나리오, (2) NULL → NOT NULL 토글 시 NULL 행 존재 여부를
  몰라 commit 후 PG error 로만 발견하던 reactive 흐름.

## Scope Boundary

- 동일 — `contract.md` § In Scope / § Out of Scope 참조. 요약:
  - In: `using_expression` 필드 (backend + TS) + PG `ALTER COLUMN … TYPE
    … USING …` emitter + `ColumnsEditor` USING input + 500 ms debounced
    `count_null_rows` probe + 인라인 경고 + closure marker 3종.
  - Out: 컬럼 reorder / rename, TABLESPACE / PARTITION / MV / TEMP,
    Mongo, USING syntax check, 기타 충돌 사전 표시.

## Invariants

- `alter_table` 단일 `ALTER TABLE … <comma-joined-parts>` SQL emission 패턴 유지.
- Sprint 236 add_column / drop_column modal 경로 회귀 0.
- `useDdlPreviewExecution` (Sprint 214) 시그니처 변경 금지.
- `validate_identifier` 재사용. USING 표현식은 free-text — identifier 처리
  대상 아님.
- `ColumnChange::Modify` 기존 caller (USING 미사용) 회귀 0 —
  `using_expression: None` default 로 byte-equivalent.
- Sprint 271c `expected_database: Option<String>` 패턴 honour 한
  `count_null_rows` — `None` byte-equivalent.
- Phase 21–26 surface 회귀 0.

## Done Criteria

1. `ColumnChange::Modify` (Rust + TS) 에 `using_expression: Option<String>`
   필드 추가, `#[serde(default)]` 명시. 직렬화 round-trip 테스트 통과.
2. PG SQL emitter 가 `new_data_type` + `using_expression` 동시 존재 시
   `ALTER COLUMN "<name>" TYPE <t> USING <expr>` 로 emit. 3 개 fixture
   (type-only, type+USING, composite) 가 통과.
3. `ColumnsEditor` MODIFY 에디터에 USING 입력 필드 표시 — `new_data_type`
   가 설정됐을 때만. placeholder / tooltip 본문 contract 그대로.
4. `count_null_rows` Tauri command + TS 래퍼 + `SELECT COUNT(*) FROM
   "<s>"."<t>" WHERE "<c>" IS NULL` SQL + 5 개 유닛 테스트 (식별자 3개 +
   interpolation 1개 + DbMismatch panic-closure 1개) 통과.
5. `ColumnsEditor` 가 SET NOT NULL 토글 시 500 ms debounce 후
   `count_null_rows` 호출. `count > 0` 이면 "`N` rows have NULL — adding NOT
   NULL will fail" 경고 inline 표시. `count === 0` 이면 표시 안 함. 차단
   없음. vitest 2 케이스 통과.
6. `docs/archives/incidents/parity-milestone/2026-05-13-tableplus-parity-phase-27-closure/memory.md`
   회고 추가.
7. `docs/PLAN.md` Phase 27 status `진행 중` → `종료`.
8. `docs/archives/roadmaps/memory-roadmap/memory.md` 패리티 마일스톤 row 갱신.
9. 모든 gate (`cargo test` / `cargo clippy` / `cargo fmt --check` /
   `pnpm tsc --noEmit` / `pnpm vitest run` / `pnpm lint`) 통과. 테스트 카운트
   monotonically non-decreasing.

## Verification Plan

- **Profile**: `mixed`.
- **Required checks**:
  1. `cd src-tauri && cargo test alter_table && cargo test count_null_rows`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo fmt --check`
  4. `cd src-tauri && cargo test --lib`
  5. `pnpm tsc --noEmit`
  6. `pnpm vitest run`
  7. `pnpm lint`
  8. Manual round-trip (vitest-mocked): edit pencil column → type → `int`
     + USING → `col::int` → Review SQL → preview 표시 `ALTER COLUMN "col"
     TYPE int USING col::int` → Execute → success.
- **Required evidence**:
  - 변경 파일 목록 + 한 줄 purpose.
  - 7 개 gate 각각의 최종 ~40 줄 tail.
  - AC-237-01 ~ AC-237-08 별 file:line + 테스트명 매핑.
  - 3 개 SQL emission fixture snapshot 의 expected SQL 문자열.
  - 2 개 conflict-probe vitest 테스트명 + 1 개 USING input vitest 테스트명.
  - Phase 27 closure marker 3 개의 절대 경로 / diff line 인용.

## Evidence To Return

- Changed files and purpose (one line each).
- 7 개 gate 의 outcome + tail.
- AC coverage table — 각 AC 의 충족 증거 (file:line + 테스트명).
- 6 개 SQL emission fixture (3 새 fixture + 3 기존 회귀 spot-check).
- 충돌 사전 표시 vitest 결과 (`count > 0` / `count === 0` 각각).
- Phase 27 closure marker 3 종 (lesson 파일 경로, `docs/PLAN.md` diff
  인용, `docs/archives/roadmaps/memory-roadmap/memory.md` diff 인용).
- Assumptions made during implementation (예: USING expression 의 escape
  처리 정책 — 본 sprint 는 free-text passthrough 로 결정).
- Residual risk or verification gaps (예: live PG 통합 테스트 없음 — fixture
  unit test 와 vitest mock round-trip 으로 cover).

## Carryover policy (sprint-local override)

- **P2 ≤ 5 분짜리 work** 가 Evaluator 에 의해 발견되면 Generator 즉시
  재호출하여 같은 sprint 안에서 닫는다. `MAX_ATTEMPTS_PER_SPRINT = 5`.
  P2 = 0 될 때까지 attempt 반복.
- **P2 가 10 분 이상 architectural** 이면 deferred 허용. 사유 + 후속
  sprint 번호를 `findings.md` 에 명기.

## References

- **Contract**: `docs/sprints/sprint-237/contract.md`
- **Phase spec**: `docs/archives/phases/completed/phase-27.md`
- **Prior contract style reference**: `docs/sprints/sprint-271/contract.md`
  (Sprint 271c DbMismatch pattern).
- **Findings (sprint-local — current)**: `docs/sprints/sprint-237/findings.md`
  (will be created by Evaluator). The pre-existing
  `findings.md` / `handoff.md` in this folder pertain to an earlier,
  unrelated workload (fixture data workflow, 2026-05-10) and are
  archival only.
- **Relevant files**:
  - `src-tauri/src/models/schema.rs:93-112` — `ColumnChange::Modify`
  - `src-tauri/src/db/postgres/mutations.rs:779-871` — `alter_table`
  - `src-tauri/src/commands/rdb/ddl.rs` — DDL command surface (Sprint
    271c integration site for `expected_database` pattern)
  - `src/types/schema.ts` — TS mirror
  - `src/lib/tauri/ddl.ts:116` — `alterTable` wrapper
  - `src/components/structure/ColumnsEditor.tsx` — MODIFY editor host
  - `src/components/structure/useDdlPreviewExecution.ts` — Sprint 214
    hook (do NOT mutate signature)
