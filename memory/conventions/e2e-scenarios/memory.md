---
title: E2E 시나리오 설계 원칙
type: memory
updated: 2026-04-30
---

# E2E 시나리오 설계 원칙

`e2e/**/*.spec.ts`를 새로 작성·수정하기 전에 이 방을 읽는다.
자동 로드: `.claude/rules/e2e-scenarios.md` 가 같은 paths를 매처로 가지고 있으므로
e2e 파일을 만지는 모든 작업은 이 원칙을 컨텍스트로 받는다.

기준점: **"끊김 없는 전환"** (`docs/PLAN.md`). E2E는 그 기준이 깨졌는지를
사용자 시점에서 검증하는 마지막 그물이다.

---

## 8 가지 원칙

### P1. 테스트 피라미드 — e2e는 "여러 컴포넌트 + 윈도우 + IPC가 모두 살아 있어야만 보이는 것"만
- 단일 컴포넌트 prop / store action / SQL 파서 같은 단위 사실은 vitest로 끝낸다.
- "Editable badge가 단일 PK SELECT에만 뜬다" 같은 로컬 규칙은 component test가 권위.
- e2e에서는 *교차-컴포넌트 의존*이 살아 있어야만 드러나는 것을 잡는다.

### P2. spec = 하나의 사용자 의도 (화면이 아닌 여정)
- 좋은 spec: "PG 연결을 처음 만들고 첫 쿼리를 실행해 결과를 확인한다".
- 나쁜 spec: 화면별 8 it 묶음 — beforeEach 셋업 비용만 큰 단위 테스트로 변질된다.
- 한 it에서 직선적으로 step 1→2→3 검증하는 것을 우선한다 (P8 step 라벨과 한 쌍).

### P3. Critical User Journey (CUJ) 회귀 0%
- TablePlus 대체 가능성에 직결되는 플로우는 별도 분류·태그로 표시한다.
- **CUJ 5종** (2026-04-30 합의):
  1. 신규 Connection 생성 → 첫 쿼리 → 결과 → 종료
  2. PG ↔ Mongo paradigm 전환 (sidebar 트리 종류 교체)
  3. Home ↔ Workspace 왕복 + tab persistence
  4. Schema 트리 → 데이터 그리드 → 셀 편집 commit
  5. 멀티 윈도우 라이프사이클 (workspace 종료/재오픈)
- CUJ 실패 = 머지 차단. 위치/태깅 방식은 Step 2(`docs/sprints/`)에서 확정.

### P4. DBMS × paradigm 매트릭스 (필요 최소)
- PG는 풀 시나리오, Mongo는 paradigm 분기점에서만. MySQL/SQLite 추가 시점에
  공통 시나리오를 parameterize 한다. *지금* 추상화하면 과조숙.
- 새 DBMS는 connection-switch 형태의 paradigm 검증 1 spec부터 들어온다.

### P5. 회귀 고정 (regression-pinned)
- 사용자-가시 버그가 한 번 발생하면 명시 spec으로 박는다.
- 박을 때는 그 버그가 발생한 sprint/ADR을 spec 상단 코멘트에 인용한다 (예: ADR 0014).
- 회귀 spec은 절대 P1으로 강등하지 않는다 — 단위 테스트로는 못 잡혀서 e2e가 된 것.

### P6. `skip()`은 부채 — 만료일이 있어야 한다
- 스캐폴드만 두고 deferred면 (a) GitHub issue 링크를 spec 코멘트에 박거나
  (b) 한 sprint 안에 본문을 채우거나 (c) spec을 지운다.
- "그대로 두기"는 금지. stale skip은 선택지 행세하는 노이즈다.
- 새 `skip()`을 추가할 때마다 `docs/sprints/{현재}/handoff.md`에 사유와 만료
  조건을 기록한다.

### P7. tauri-driver 한계와 화해
- tauri-driver로 못 잡는 것: OS 컨텍스트 메뉴, Radix Select portal, 마우스
  호버 툴팁, 네이티브 다이얼로그.
- 처리 우선순위:
  1. component test로 강등 (P1).
  2. portal 회피용 selector를 프로덕션 코드에 노출 (`data-testid`,
     `aria-label`) — 단, 그 selector는 prod 사용자 경험을 망가뜨리지 않는
     선에서.
  3. 그래도 안 되면 명시적 `skip()` + 사유 코멘트 + 이슈 링크 (P6 적용).

### P8. 실패 진단성 — "한 줄 로그로 step이 보여야 한다"
- 모든 e2e step은 라벨링: `await step("schema tree mounts", async () => {...})`.
- 실패 시 `e2e/wdio-report/`에 스크린샷 + DOM 덤프 자동 저장 (afterTest hook).
- selector timeout 메시지에 step 라벨이 박혀야 "어디서 죽었는지" 즉시 보인다.

---

## 진행 순서 (2026-04-30 결정)

1. **Inventory triage** — 모든 `skip()`을 (a)삭제 / (b)component 이전 / (c)부활 분류
2. **CUJ 못박기** — 위 5종을 `e2e/cuj/` 또는 태그로 분리
3. **누락 영역 채우기** — 셀 편집, dirty, preview tab, 에러 회복, 페이지네이션,
   워크스페이스 라이프사이클
4. **Flakiness 잡기** — step 라벨 헬퍼, 실패 시 스크린샷, helpers timeout 표준화

각 단계는 별도 sprint로 진행한다 (`docs/sprints/sprint-N/`).

---

## 새 e2e spec을 추가하기 전 체크리스트

- [ ] 이 시나리오가 vitest/component test로 동등하게 잡히는가? → 그렇다면 e2e에 두지 않는다.
- [ ] CUJ 5종 중 하나인가? → `e2e/cuj/` 위치/태그 적용.
- [ ] 회귀 고정인가? → 상단 코멘트에 sprint/ADR 인용.
- [ ] tauri-driver 한계에 걸리는가? → P7 우선순위로 처리.
- [ ] 모든 step에 `step("...")` 라벨이 있는가?
- [ ] `skip()`을 새로 추가했다면 만료 조건이 sprint handoff에 기록됐는가?

---

## 관련 방

- [conventions](../memory.md) — 코딩 컨벤션 (테스트 일반)
- [decisions/0014-e2e-switchwindow-multi-window](../../decisions/0014-e2e-switchwindow-multi-window/memory.md) — 멀티 윈도우 e2e 패턴
- [roadmap](../../roadmap/memory.md) — 어떤 phase의 어떤 기능까지 e2e 대상인지
- 자동 로드 stub: `.claude/rules/e2e-scenarios.md`
