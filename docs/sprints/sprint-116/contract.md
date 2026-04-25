# Sprint Contract: sprint-116

## Summary

- Goal: `docs/ui-evaluation-results.md` §8 의 9 개 ⚠️ 항목 (정적 분석으로는 판정 불가, 실측이 필요한 항목) 을 별도 추적 문서 `docs/ui-evaluation-followup.md` 로 외화. 항목별 검증 절차 / 담당 / 종결 조건 + 상태(active/verified/deferred) + 신규 항목 추가 절차 + RISKS.md / master index 참조까지 갖춰 "⚠️ 가 잊히지 않도록" 운영 문서화.
- Audience: 평가자 / 메인테이너. 실측 큐 (FPS, VoiceOver, 창 크기 등) 가 명확히 정리된 상태로 다음 사이클에 인계.
- Owner: 메인테이너 (Felix).
- Verification Profile: `static`

## In Scope

- 신규 파일 `docs/ui-evaluation-followup.md`:
  - 머리말: 출처 (`ui-evaluation-results.md` §8) + 본 문서 목적 + 상태 어휘 정의 (`active` / `verified` / `deferred`).
  - 9 개 ⚠️ 항목별 row, 다음 컬럼 또는 동등 구조 포함:
    1. ID (`UI-FU-01` ~ `UI-FU-09`)
    2. 한 줄 요약
    3. 출처 (`ui-evaluation-results.md` §8 의 해당 줄)
    4. 검증 절차 (실측 방법: 도구, 명령, 시나리오)
    5. 담당 (현재는 unassigned 또는 메인테이너)
    6. 종결 조건 (어떤 결과가 나오면 verified / deferred 인지)
    7. 상태 (모두 `active` 로 시작)
  - 푸터: "신규 ⚠️ 항목을 추가하는 절차" — 새 ID 부여, source 링크, 종결 조건 작성, RISKS.md cross-link 갱신.
- `docs/RISKS.md` 또는 `docs/PLAN.md` master 위치 중 한 곳에 새 문서 링크 1 개 이상 추가 (선호: `RISKS.md` 상단 Summary 직후, "참고 문서" 섹션 또는 동등).
- 기존 어떤 코드도 변경하지 않는다.

## Out of Scope

- ⚠️ 항목 자체의 실측 / 해결 (별도 sprint 의 책임).
- §8 외의 항목 추적 (§6.5 의 사용자 리포트 5건, §7 P2 등은 이미 우선순위 설정됨).
- `RISKS.md` 의 항목 자체 수정. 본 sprint 는 "참조 추가" 만.
- `ui-evaluation-results.md` 의 §8 자체 수정 (출처 보존).

## Invariants

- 1822 baseline tests 회귀 0 (코드 미변경 → 자동 보장).
- `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 통과 (코드 미변경 → 자동 보장).
- `memory/` 트리 변경 없음.
- ADR / 기존 메모리 본문 수정 없음.

## Acceptance Criteria

- `AC-01`: `docs/ui-evaluation-followup.md` 존재. 머리말이 출처와 상태 어휘를 명시.
- `AC-02`: §8 의 9 개 ⚠️ 항목이 누락 없이 모두 포함 (테마 AA / SchemaTree FPS / DataGrid 페이지 1000 / 스크린리더 / 창 최소 크기 / Cmd+Shift+I prod / EmptyState MRU / Mongo 편집 경로 / pendingEditErrors 좁은 컬럼).
- `AC-03`: 각 항목에 (a) 검증 절차, (b) 담당, (c) 종결 조건 3 요소가 모두 들어 있다.
- `AC-04`: 각 항목이 `active` / `verified` / `deferred` 중 하나의 상태값을 가진다 (초기값은 모두 `active` 가능).
- `AC-05`: `docs/RISKS.md` 또는 master index 에서 본 문서를 한 번 이상 참조 (링크).
- `AC-06`: 문서 끝 또는 별도 섹션에 신규 ⚠️ 항목 추가 절차가 기재되어 있다.
- `AC-07`: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 통과 (코드 변경 없음을 증거로).

## Design Bar / Quality Bar

- 표가 가독적이고 grep 가능하도록 ID 컬럼은 `UI-FU-NN` 형식 고정.
- 종결 조건은 "측정 가능한 임계값" (예: "60 FPS 이상" / "WCAG AA 4.5:1 이상") 을 가능한 한 포함.
- 절차에 명령 / 도구 / 시나리오 명시 (예: `pnpm tauri dev` + macOS VoiceOver Cmd+F5).
- 한국어 주 (영어 식별자 / 키워드 OK).
- 200 줄 이내.

## Verification Plan

### Required Checks

1. `docs/ui-evaluation-followup.md` 존재 + 9 개 항목 포함 (grep `UI-FU-01` ~ `UI-FU-09`).
2. `docs/RISKS.md` (또는 PLAN.md) 가 신규 문서를 한 번 이상 참조.
3. `pnpm vitest run` 통과 (1822/1822 유지).
4. `pnpm tsc --noEmit` 0.
5. `pnpm lint` 0.

### Required Evidence

- Generator must provide:
  - 신규 문서 경로 + 9 개 항목 ID 리스트 + 각 ID 의 한 줄 요약.
  - RISKS.md (또는 master index) 에 추가한 라인.
  - 검증 명령 결과 (vitest pass count, tsc/lint 0).
- Evaluator must cite:
  - AC 별 통과 여부 + 근거 (파일:라인).
  - 누락된 ⚠️ 항목이 있는지 §8 과 cross-check.

## Test Requirements

### Unit Tests (필수)

- 본 sprint 는 정적 문서 sprint. 신규 코드 / 신규 동작 없음 → 단위 테스트 추가 없음.
- 회귀 0 보장은 기존 1822 테스트의 무회귀로 충당.

### Coverage Target

- 코드 변경 없음 → 신규 커버리지 N/A.
- CI 전체 기준 유지: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] Happy path: §8 항목 9 개 모두 매핑.
- [x] 경계 조건: 출처 §8 외 항목 (§6.5, §7) 은 추가하지 않음.
- [x] 회귀 없음: 코드 변경 0 → 자동 보장.

## Test Script / Repro Script

1. `cat docs/ui-evaluation-followup.md` → 9 개 항목 + 신규 추가 절차 확인.
2. `grep -nE 'UI-FU-0[1-9]' docs/ui-evaluation-followup.md` → 9 줄.
3. `grep -nE 'ui-evaluation-followup' docs/RISKS.md docs/PLAN.md` → 1 줄 이상.
4. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`.

## Ownership

- Generator: 일반 에이전트 또는 메인테이너 직접 (소규모 정적 문서 → 직접 적용).
- Write scope: `docs/ui-evaluation-followup.md` (신규), `docs/RISKS.md` (참조 1 줄), `docs/sprints/sprint-116/{contract,execution-brief,handoff}.md`.
- Merge order: 본 문서 → execution brief → 문서 작성 → 검증 → handoff.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes`.
- Acceptance criteria evidence linked in `handoff.md`.
