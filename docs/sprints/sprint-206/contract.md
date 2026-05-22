# Sprint 206 — Contract

Sprint: `sprint-206` (refactor — e2e skip 점검 + placeholder 정리).
Date: 2026-05-05.
Type: refactor (행동 변경 0; e2e 실행 면적 동일 — skip 표시만 사라짐).

[`docs/PLAN.md`](../../PLAN.md) Sprint 206 row + `/CODE_SMELLS.md` §6.
[`memory/conventions/e2e-scenarios/memory.md`](../../../memory/conventions/e2e-scenarios/memory.md) "skip 은 부채" 원칙.

## 배경

CODE_SMELLS §6 의 본질: e2e suite 에 누적된 placeholder skip 들이 (a)
CI 에서 통과로 보이지만 실제 실행되지 않고 (b) 신규 기여자에게 안전성
오해를 유발한다. e2e-scenarios 8 원칙 P6 ("skip 은 부채") + P7
("tauri-driver 한계 → selector 노출 → skip+이슈, 그 순서") 를 적용해
일괄 정리.

## skip 분류 (16곳)

| 카테고리 | 갯수 | 처리 |
|----------|------|------|
| **env-skip 정당** (fixture 환경 부재 → skip) | 5 | 보존. 사유 + 환경 변수 명시. |
| **body-placeholder** (본문 = `this.skip()` + `expect(true).toBe(true)`) | 11 | 제거. outline 은 archive 보존. |

### env-skip 5곳 (보존)

| 파일 | 라인 | 사유 |
|------|------|------|
| `e2e/connection-switch.spec.ts` | 108 | `E2E_MONGO_HOST` 부재 시 skip — 본문은 PG↔Mongo 실 swap 검증 |
| `e2e/keyboard-shortcuts.spec.ts` | 108 | `PGHOST` / `E2E_PG_HOST` 부재 시 skip — 본문은 Cmd+, 실 토글 검증 |

(나머지 3곳은 아래 body-placeholder 처리에 따라 파일 삭제로 동시 제거됨.)

### body-placeholder 11곳 (제거)

| 파일 | 처리 | 시작 skip 갯수 |
|------|------|----------------|
| `e2e/feedback-2026-04-27.spec.ts` | 5 describe 제거 (#1, #2, #5, #10, #12). #6 LIVE 만 보존. | 8 → 0 |
| `e2e/db-switcher.spec.ts` | 파일 전체 삭제 (Sprint 133 scaffold, 본문 미구현). | 4 → 0 |
| `e2e/raw-query-db-change.spec.ts` | 파일 전체 삭제 (Sprint 133 scaffold, 본문 미구현). | 2 → 0 |

총 14 skip 제거 + 2 파일 삭제.

종료 skip 갯수: 16 → 2 (`connection-switch:108` + `keyboard-shortcuts:108`).

## Sprint 안에서 끝낼 단위

### 변경 파일

수정:
- `e2e/feedback-2026-04-27.spec.ts` — 5 describe 제거 (#1 home picker REVIVE,
  #2 connection swap, #5 encrypted×3, #10 row count, #12 mongo persist).
  머리주석에서도 placeholder 언급 제거. #6 LIVE describe + 권위 component
  test 인용 코멘트 보존.

삭제:
- `e2e/db-switcher.spec.ts` — Sprint 133 scaffold. 본문 미구현 placeholder.
- `e2e/raw-query-db-change.spec.ts` — Sprint 133 scaffold. 본문 미구현
  placeholder.

신규:
- `docs/sprints/sprint-206/archived-placeholders.md` — 제거된 placeholder 의
  outline 아카이브. 후속 sprint 가 본문 작성 시 진입 자료로 활용.
- `docs/sprints/sprint-206/{contract,findings,handoff}.md`

### archived-placeholders.md 의 역할

placeholder 시나리오 outline (각 it() 의 머리주석) 보존:
- #1 viewport, #2 connection swap, #5 encrypted×3, #10 row count, #12 mongo,
  db-switcher PG / Mongo, raw-query \\c admin

후속 sprint 가 본문 작성 시:
1. archive 의 outline 읽고
2. 권위 component test 가 있는지 재검증
3. P1 (피라미드) 적용 후 e2e 본문 작성 — outline 의 step 들을 step("...")
   라벨로 변환

## Acceptance Criteria

### AC-206-01 — e2e skip 갯수 16 → 2

- `grep -rnE "(it\.skip|this\.skip|describe\.skip|xit|it\.todo|\.todo\(|\.only)" e2e/`
  → `connection-switch.spec.ts:108` + `keyboard-shortcuts.spec.ts:108` 만
  매치 (2곳). 다른 매치 0건.

### AC-206-02 — 보존된 env-skip 의 사유 명확

- `connection-switch.spec.ts:108` skip 직전 환경 변수 (`E2E_MONGO_HOST`)
  명시 — 기존 코드 그대로.
- `keyboard-shortcuts.spec.ts:108` skip 직전 환경 변수 (`PGHOST` /
  `E2E_PG_HOST`) 명시 — 기존 코드 그대로.

### AC-206-03 — archive outline 보존

- `docs/sprints/sprint-206/archived-placeholders.md` 존재.
- 11 제거된 placeholder 의 outline (각 it() body 의 step 주석) + 권위
  component test 인용 + 후속 진입 트리거 (sprint 후보 또는 환경 변수)
  포함.

### AC-206-04 — 회귀 0

- `pnpm tsc --noEmit` exit 0.
- `pnpm lint` exit 0.
- `pnpm vitest run` baseline (Sprint 205 = 189 files / 2732 tests) 동일.
- `e2e/` 의 남은 spec 파일 들이 syntax error 없이 dry-load (compile).

## Out of scope

- **e2e 본문 작성** — placeholder 가 명시한 시나리오 (#1 viewport, #2
  swap 등) 의 실제 본문은 후속 sprint. 본 sprint 는 정리만.
- **`describe.skip` / `it.todo` / `xit` 도입** — e2e-scenarios P6 기준
  "skip 은 부채" — 본 sprint 가 정리하는 부채를 새 형태로 다시 추가하지
  않는다.
- **CI workflow 수정** — `.github/workflows/ci.yml` 의 e2e job 은 ADR
  0019 로 이미 제거. lefthook pre-push 에서만 실행. 본 sprint 변경
  없음.

## 검증 명령

```sh
pnpm tsc --noEmit
pnpm lint
pnpm vitest run
grep -rnE "(it\.skip|this\.skip|describe\.skip|xit|it\.todo|\.todo\(|\.only)" --include="*.ts" e2e/ | grep -v "^.*://"
```

기대값: tsc 0 / lint 0 / vitest 189 files 2732 tests pass / e2e skip
grep 결과 = 2 match (`connection-switch.spec.ts:108` +
`keyboard-shortcuts.spec.ts:108`).
