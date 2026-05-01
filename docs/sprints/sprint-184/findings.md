# Sprint 184 — Findings

Sprint: `sprint-184` (Phase 22 closer / TablePlus 패리티 #3 종료).
Date: 2026-05-01.

## 1. 본 sprint 의 *코드 변경 0* 결정

**결정**: Sprint 184 는 신규 production 코드를 **0줄** 추가한다. 작업
범위는 (a) 회귀 가드 테스트 1 파일, (b) Phase 22 종료 메타 문서, (c)
sprint 산출물 3 문서 뿐.

**이유**:
- Sprint 184 contract 의 baseline 조사 결과 update / insert / delete 세
  경로가 *이미* `useDataGridEdit.handleCommit` (`generateSqlWithKeys` /
  `generateMqlPreview` 단일 진입점) 을 거쳐 단일 게이트를 통과한다는
  사실이 확인됐다 (`src/components/datagrid/useDataGridEdit.ts:594-683`).
- Sprint 183 이 `executeQueryBatch` 로 RDB 의 batch dispatch 를 통일
  했고, Mongo 분기는 Sprint 86 부터 `dispatchMqlCommand` 로 단일 진입.
- 즉 본 sprint 가 *추가*해야 할 게이트 통합 코드는 없다. 회귀 가드와
  perf 알람만 부족했다.

**트레이드오프**: "신규 코드 0 = sprint 의미 없음" 비판이 있을 수 있다.
그러나 (a) 게이트 일관성을 자동 회귀로 핀하지 않으면 후속 Phase 23~27
(Safe Mode / Index UI / Constraint UI / Trigger / DDL UI) 이 mutation
경로를 추가할 때 이 인변(invariant)이 silently 깨질 수 있고, (b) Phase
22 의 closer sprint 가 없으면 Phase 22 가 *언제* 끝났는지 그리고 *어떤
기준으로* 끝났는지를 후속 작업이 알 수 없다. 따라서 회귀 가드 + 종료
마킹 자체가 sprint 의 본업.

## 2. AC 별 회귀 가드 의도

### AC-184-01: RDB UPDATE + INSERT + DELETE single batch

세 statement 종류가 같은 `executeQueryBatch` 호출 한 번에 들어가는지
직접 단언. 후속 Phase 가 (예) DELETE 만 별도 HTTP / IPC 로 분리하려는
실수를 자동으로 잡는다. 또한 `executeQuery` (single-stmt 레거시) 호출
0회 단언이 Sprint 183 의 트랜잭션 wrap 회귀 가드를 본 sprint 에서도
재확인.

### AC-184-02: Mongo insertOne + updateOne + deleteOne sequential

Mongo 가 *순차* dispatch 임을 직접 단언. 추후 Mongo 트랜잭션 sprint 가
이 인변을 깨려면 본 테스트 자체를 의도적으로 갱신해야 한다 — 즉 그
변경이 "원자성" 가설이 도입됐다는 신호로 작동한다. 또한 Mongo 분기에서
RDB 의 `executeQueryBatch` / `executeQuery` 가 호출되지 않음을 단언해
paradigm 분기가 새지 않게 핀.

### AC-184-03: 100-edit perf smoke (UPDATE)

`generateSqlWithKeys` 의 inner loop 가 N=100 에서 1000ms 안에 끝나야
한다. 실측은 보통 10~30ms (M-series Mac). 1000ms ceiling 은 CI runner
의 cold-start jitter 흡수용. 진짜 회귀 (예: O(N²) `pendingEdits.forEach`
중첩) 시 즉각 fail.

### AC-184-04: 100-delete perf smoke (DELETE)

`pendingDeletedRowKeys.forEach` 의 WHERE-절 빌드가 같은 budget 안에
끝나야 한다. delete 는 PK 추출 + literal 만 하므로 측정값이 update
보다 빠르다 (≤20ms 통상).

### AC-184-05: 100-insert perf smoke (INSERT, duplicate-based)

INSERT 는 모든 컬럼을 채워야 하므로 setup 비용이 가장 크다. setup 을
peg 에서 빼기 위해 `handleDuplicateRow` × 100 으로 pendingNewRows 를
일거에 만들고, measurement 는 `handleCommit` 호출 직전·직후만 sandwich.
같은 PK 100 회 복제는 SQL 문자열 *생성* 만 검증할 뿐 실행하지 않으므로
PK 충돌 위험 없음.

### AC-184-06: Phase 22 종료 마킹

`docs/phases/phase-22.md` 의 status 줄이 "계획" → "완료 (2026-05-01,
Sprint 181~184)" 로 갱신됐고, "작업 단위" 섹션에 sprint 별 실측 결과 +
commit 인용이 들어갔으며, "Exit Criteria" 4 항목 각각에 evidence
(어느 sprint 의 어느 AC) 가 매핑됐다. Phase 본문의 *결정* 부분은
무수정 (ADR 동결 정책과 일치).

### AC-184-07: 회귀 가드 (코드 무수정)

본 sprint 가 의도적으로 코드 0줄 변경. `git diff src-tauri/` /
`src/components/datagrid/useDataGridEdit.ts` /
`src/components/query/EditableQueryResultGrid.tsx` /
`src/components/query/PendingChangesTray.tsx` /
`src/components/datagrid/sqlGenerator.ts` /
`src/components/datagrid/mqlGenerator.ts` /
`src/lib/tauri.ts` / store 들 모두 *empty diff*.

## 3. Mongo 트랜잭션 부재 — 재확인

Sprint 183 findings §4 와 동일 — Mongo multi-document transaction 은
replica set 또는 sharded cluster 환경을 요구하고, 본 프로젝트의 e2e
harness (single-node docker compose) 는 그 환경을 제공하지 않는다. 본
sprint 의 AC-184-02 는 *순차 dispatch* 만 핀하지 *원자성* 은 핀하지
않는다. Mongo 트랜잭션은 별도 sprint (replica-set ADR + harness 갱신
포함) 의 작업.

## 4. perf budget 산정 근거

| AC | budget | 실측 (M3 Pro 로컬) | 안전 마진 |
|----|--------|--------------------|-----------|
| AC-184-03 (100 UPDATE) | 1000ms | 약 10~30ms | 30~100x |
| AC-184-04 (100 DELETE) | 1000ms | 약 5~20ms | 50~200x |
| AC-184-05 (100 INSERT) | 1000ms | 약 15~40ms | 25~70x |

CI runner (GitHub Actions M-series 가 아닐 수 있음) 의 jitter 흡수를
위해 안전 마진 25x 이상을 의도. 진짜 회귀 (O(N²)) 시 elapsed 가 1~10
초 단위로 튀므로 fail 이 즉각 가시화된다.

본 budget 은 **flake 방지용 상한** 이지 **최적화 목표** 가 아니다.
실측이 30ms 인 코드를 50ms budget 으로 좁히면 GC / context-switch jitter
한 번에 fail 이 발생할 수 있어 신호:잡음 비가 떨어진다.

## 5. AC → 테스트 매핑

| AC | 검증 위치 | 형태 |
|----|-----------|------|
| AC-184-01 | `useDataGridEdit.mixed-batch.test.ts` `[AC-184-01]` | Vitest |
| AC-184-02 | 같은 파일 `[AC-184-02]` | Vitest |
| AC-184-03 | 같은 파일 `[AC-184-03]` | Vitest (perf) |
| AC-184-04 | 같은 파일 `[AC-184-04]` | Vitest (perf) |
| AC-184-05 | 같은 파일 `[AC-184-05]` | Vitest (perf) |
| AC-184-06 | `docs/phases/phase-22.md` (status + 매핑 표 + Exit evidence) | doc |
| AC-184-07 | `git diff` 절 (Verification Plan §8) | static |

## 6. Evidence index

- Vitest mixed-batch: `pnpm vitest run
  src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` →
  `5 passed`. 약 650ms (모두 합쳐).
- Vitest 전체: `pnpm vitest run` → `171 files, 2546 tests passed`.
- TypeScript: `pnpm tsc --noEmit` → exit 0.
- ESLint: `pnpm lint` → exit 0.
- Cargo test: `cd src-tauri && cargo test --lib` →
  `326 passed; 0 failed; 2 ignored`.
- Cargo clippy: `cd src-tauri && cargo clippy --all-targets --all-features
  -- -D warnings` → no warnings.
- Cargo fmt: `cd src-tauri && cargo fmt --check` → no diff.

Static greps (Verification Plan §8):
- `git diff src/components/datagrid/useDataGridEdit.ts` → empty.
- `git diff src-tauri/` → empty.
- `git diff src/components/query/PendingChangesTray.tsx
  src/components/query/EditableQueryResultGrid.tsx
  src/components/datagrid/sqlGenerator.ts
  src/components/datagrid/mqlGenerator.ts
  src/lib/tauri.ts` → empty.
- `grep -RnE 'it\.(skip|todo)|xit\('
  src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` → 0 matches.

## 7. Assumptions

- `handleDuplicateRow` 가 같은 PK 값을 100번 복제해도 sqlGenerator 가
  INSERT statement 100건을 emit. (확인됨 — sqlGenerator 는 PK 중복을
  검증하지 않고 SQL 문자열 생성에만 집중.)
- vitest `act()` 한 번의 overhead 가 1ms 내외 — 100×3 act() 호출이
  setup 시간을 1초 미만으로 묶음. measurement 는 commit phase 만이라
  setup 시간이 budget 에 영향 0.
- CI runner 가 M-series Mac 보다 5~10x 느려도 budget 1000ms 는 안전.
  더 큰 jitter 가 발생하면 perf 알람으로 별도 sprint 가 처리.

## 8. Residual risk

- **CI runner perf jitter**: GitHub Actions 의 cold-start 가 1초를
  넘으면 false-positive fail. 발생 시 budget 을 2000ms 로 완화하거나
  이 테스트들을 `describe.skip` 하지 *말고* 별도 `perf` tag 로 옮겨
  CI 에서만 skip 하는 옵션이 있다. 본 sprint 는 skip 인프라를 도입하지
  않음 (skip-zero gate).
- **Mongo 트랜잭션 부재**: Sprint 183 residual risk 와 동일. 별도
  sprint.
- **PendingChangesTray 의 INSERT 미표시**: Sprint 182 design 결정 —
  raw query editor (`EditableQueryResultGrid`) 가 INSERT UI 를 노출하지
  않으므로 트레이도 INSERT 를 표시하지 않는다. DataGrid 측 toolbar 의
  "N new" 배지가 INSERT 카운트를 보여준다. 두 surface 간 비대칭은
  의도된 design (raw query editor 의 mutation 표면적을 좁게 유지).
  상세는 Sprint 182 findings.

## 9. Phase 22 종료 보고

Sprint 181 (export 단판승) 은 Phase 22 의 *전제* 가 아니라 패리티
sequence 의 #1 으로 별 phase 였으나, sprint 번호 sequence 상 Phase 22
sprints 의 *직전* 에 위치한다. Phase 22 본 sprint range 는 182~184.

Phase 22 종료 후 다음 작업: **Phase 23 Safe Mode** (sprint 추정 185).
Production-tagged 연결에서 mutation 게이트에 confirmation 단계 + 명시적
타이핑 ("DELETE", "UPDATE", 또는 테이블 이름 재타이핑) 추가. 본 phase
의 게이트 인터페이스 (props/events) 위에 얹히는 형태로, 본 phase 의
산출물 무파괴.
