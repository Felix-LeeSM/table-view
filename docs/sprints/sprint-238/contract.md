# Sprint Contract: sprint-238

## Summary

- Goal: DataGrid (RDB + Document) cell layout 정책 단일 모델 lock — 1줄 fixed + category 기반 폭 + drag-resize + ellipsis. 스크롤 중 column 폭 변동 회귀 차단.
- Audience: TablePlus 워크플로우 사용자 (records 뷰에서 긴/구조적/RTL 데이터 다룸).
- Owner: Sprint 238 generator
- Verification Profile: `mixed` (command + browser)

## In Scope

- AC-238-01 ~ AC-238-12 — `docs/sprints/sprint-238/spec.md` 참조 (master contract).
- 백엔드: Rust `ColumnCategory` enum, dialect 4개 (PG/MySQL/SQLite/Mongo) `data_type` → category 매핑.
- 프론트엔드: `useColumnWidths` 훅, `columnCategory.ts`, `jsonCell.ts`, DataRow/HeaderRow/DataGridTable/DataGridToolbar 수정.
- 테스트: dialect 별 mapping unit test, `useColumnWidths.test.ts`, `columnCategory.test.ts`, `jsonCell.test.ts`, `DataGridToolbar.test.tsx`, `DataRow.test.tsx`.

## Out of Scope

- Detail expansion 신규 UI / Column width persist / Column reorder / Column sort UI 변경 / Cell editor 수정.
- Reset 키보드 단축키 (toolbar 버튼만 이번 sprint).
- Structure view 의 column widths 정책 (다른 컴포넌트 사용).
- 사용자 보고 #1, #2, #4 — 별도 sprint.

## Invariants

- **`data_type` 보존**: structure / records 뷰는 raw `data_type` 그대로 표시. category 로 치환 금지.
- **NULL 표시**: 기존 italic muted "NULL" 유지 (AC-238-10).
- **QuickLook**: `src/components/shared/QuickLookPanel/` 그대로, 새 detail UI 만들지 않음 (AC-238-09).
- **Edit mode**: 기존 cell editor layer 변경 없음. 수정 시 원본 cell 가시.
- **cmd+R / F5 동작**: data refetch 만, layout state 안 건드림 (AC-238-12).
- **width persist 금지**: localStorage / 백엔드 storage 에 저장하지 않음. 세션 메모리만.
- **min/max guard 0**: drag-resize 시 column 폭에 인위적 한도 없음 (사용자 자유).
- **Pre-push hook**: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo test`, `cargo clippy --all-targets --all-features -- -D warnings`, e2e 통과해야 머지 가능.

## Acceptance Criteria

`docs/sprints/sprint-238/spec.md` 의 AC-238-01 ~ AC-238-12 전체 (개별 항목 spec 참조).

핵심 검증 포인트:
- `AC-238-02`: Rust `QueryColumn { name, data_type, category }` 직렬화. dialect 4개 매핑 unit test.
- `AC-238-03`: `useColumnWidths` 가 sum < container 시 비례 확대, sum ≥ container 시 default 유지.
- `AC-238-04`: drag 후 자기 column 만 변경, container 폭 변동 시 재계산 안 함.
- `AC-238-05+06`: `truncateCell` / `CELL_DISPLAY_LIMIT` / `line-clamp-3` grep 결과 0건. CSS ellipsis + bidi 적용.
- `AC-238-07`: circular ref / BigInt → `"[unserializable]"` fallback.
- `AC-238-08`: int/float text-right, bool text-center, 그 외 text-left.
- `AC-238-11`: `min-w-full` 클래스 제거 (DataGridTable 양쪽).
- `AC-238-12`: toolbar 버튼 onClick → useColumnWidths.reset() 호출.

## Design Bar / Quality Bar

- Lint: `pnpm lint` 0 error.
- Type: `pnpm tsc --noEmit` 0 error.
- Rust: `cargo clippy --all-targets --all-features -- -D warnings` 0 warning.
- Test coverage: 신규/수정 파일 라인 70% 이상.
- 기존 테스트 0건 회귀.
- CLAUDE.md, react-conventions.md, testing.md 컨벤션 준수.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 모든 frontend 테스트 통과 (신규 + 기존).
2. `pnpm tsc --noEmit` — 타입 체크 0 error.
3. `pnpm lint` — ESLint 0 error.
4. `cargo test` (in `src-tauri/`) — Rust unit test 통과.
5. `cargo clippy --all-targets --all-features -- -D warnings` — 0 warning.
6. Manual browser smoke (records 뷰):
   - 좁은 viewport 에서 column 합계 < container → 비례 확대 후 채움 (잔여 공간 0).
   - 넓은 viewport 에서 column 합계 ≥ container → horizontal scroll.
   - drag-resize 시 자기 column 만 변경.
   - "Reset column widths" 버튼 클릭 → 산식 재실행, drag 결과 폐기.
   - 사이드바 열림/닫힘 시 column 폭 불변.
   - 긴 cell 값 → ellipsis (...) 표시, line-clamp 다줄 없음.
   - JSON / object cell → compact 한 줄.
   - RTL 텍스트 cell → 자체 방향 자동, 인접 cell 영향 없음.
   - cmd+R → 데이터만 refetch, 폭 그대로.
7. Grep 검증:
   - `rg "truncateCell\|CELL_DISPLAY_LIMIT\|line-clamp-3" src/` → 0건.
   - `rg "min-w-full" src/components/datagrid/` → 0건.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 + 각 파일의 변경 목적.
  - 위 7 checks 의 실제 출력 / 스크린샷 (browser 검증).
  - 각 AC 마다 어떤 테스트가 cover 하는지 매핑.
  - 회귀 테스트 결과 (기존 테스트 통과 증명).
- Evaluator must cite:
  - 각 AC 의 pass/fail 판정에 대한 구체적 근거 (테스트 이름, 파일 경로, 명령 출력).
  - 누락/약한 증거를 finding 으로 명시.

## Test Requirements

### Unit Tests (필수)

- AC-238-02: dialect 4개 매핑 unit test (PG `int4`/`varchar`/`uuid` 등, MySQL `int`/`text`, SQLite `INTEGER`/`TEXT`, Mongo BSON Int32/String/ObjectId).
- AC-238-03: `useColumnWidths` 의 (c) 산식 — `sum < container` / `sum ≥ container` / `sum == container`.
- AC-238-04: drag handler 가 자기 column 만 갱신. container resize 후 재계산 없음.
- AC-238-07: `safeStringifyCell` — null/primitive/nested object/array/circular/BigInt/Symbol.
- AC-238-08: `columnCategory.getTextAlign('int')` 등.
- AC-238-12: toolbar reset 버튼 onClick.

### Coverage Target

- 신규 파일 (`useColumnWidths.ts`, `columnCategory.ts`, `jsonCell.ts`): 라인 80% 이상.
- 수정 파일 (DataRow.tsx, HeaderRow.tsx, DataGridTable.tsx, DataGridToolbar.tsx): 라인 70% 이상.

### Scenario Tests (필수)

- [ ] Happy path: SELECT 결과 → category 매핑 → 폭 산식 → 1줄 ellipsis 렌더.
- [ ] 에러: circular JSON, 미지 raw type, container 폭 0.
- [ ] 경계: column 0개, 매우 좁은 viewport, 매우 넓은 viewport, sum == container.
- [ ] 회귀: 기존 cell editor 동작, NULL 표시, QuickLook 토글, cmd+R 동작.

## Test Script / Repro Script

1. `pnpm vitest run src/lib/columnCategory.test.ts src/lib/jsonCell.test.ts src/hooks/useColumnWidths.test.ts`.
2. `pnpm vitest run src/components/datagrid/`.
3. `cd src-tauri && cargo test`.
4. `pnpm tauri dev` → records 뷰 진입 → manual browser smoke 7 항목 실행.
5. Grep 명령 2개 실행하여 0건 확인.

## Ownership

- Generator: Sprint 238 generator (TDD 적용)
- Write scope:
  - `src-tauri/src/models/`, `src-tauri/src/db/postgres.rs`, `mysql.rs`, `sqlite.rs`, `mongo.rs`
  - `src/types/query.ts`
  - `src/lib/columnCategory.ts`, `src/lib/jsonCell.ts`, `src/lib/format.ts`
  - `src/hooks/useColumnWidths.ts`
  - `src/components/datagrid/DataGridTable.tsx`
  - `src/components/datagrid/DataGridTable/DataRow.tsx`, `HeaderRow.tsx`
  - `src/components/datagrid/DataGridToolbar.tsx`
  - 위 파일들의 `*.test.ts(x)`
- Merge order: 단일 sprint 내 한 PR 또는 leaf 단위 커밋 시리즈.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (모든 7 checks)
- Acceptance criteria evidence linked in `handoff.md`
- 기존 테스트 회귀 0건
- Pre-push hook 통과 (cargo test, cargo clippy, pnpm vitest, pnpm lint, pnpm tsc, e2e)
