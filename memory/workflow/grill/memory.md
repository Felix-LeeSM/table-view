---
title: Grill — 결정 인터뷰 룰
type: workflow-rule
updated: 2026-05-20
task: grill, decision-lock, planning, option-design, memory-grill
trigger:
  signal: 사용자가 결정 / 선택지 / "grill" 요청
  layer: agent-prompt (grill-planner agent 진입)
---

# Grill — 결정 인터뷰 룰

설계/계획/옵션 lock 단계의 사용자 인터뷰 패턴. 본 방의 룰은 모든 grill 세션의 default.

## 1. 한 메시지 = 결정 1개

- 한 메시지에 결정 1개 + 옵션 (a/b/c) + 추천 + 짧은 이유.
- 두 개 이상 결정 묶지 않음. "동의?" 일괄 확인 금지.
- 의존 후속 결정이 보여도 답 받은 뒤 다음 메시지.

**Why**: 여러 결정 동시 인터뷰는 인지 부하 → 답 흐려짐 + 중간 옵션 누락. 사용자 2회 명시 lock (2026-05-09, 2026-05-10). 빠른 진행보다 인지 흐름 유지 우선.

**예외**: 사용자가 "여러 개 묶어서 진행해" 명시 시 그 범위만 묶음.

## 2. 옵션 분해는 두 축

옵션 작성 시 다음 두 축 모두 고려:

- **기술 축** — implementation 비용 / 위험 / 의존성 / 유지 부담
- **유저 플로우 축** — task 빈도 / 가치 / 막히는 지점 / 이미 다른 결정으로 커버되는지

한 축만 보면 옵션 분해 편향:

- 기술 축만 → 사용자 가치 없는 implementation 차이 묶음 (2026-05-14 Mongo Q18 "1/2/3 어떤 차이?" 사례).
- 유저 플로우 축만 → 비용/위험 무시한 비현실 옵션.

옵션 명세 시 각 옵션을 두 축으로 환원: "이 옵션이 어떤 task 를 어떻게 바꾸나 + 비용/위험은 어떻게 다른가". 한 축에서 동등하면 다른 축으로 cut. 두 축에서 모두 동등하면 옵션 폐기.

**Why**: 사용자가 결정 가치 판단 시 두 축 모두 필요. 한 축 편향은 답 시간만 소모.

## 3. 텍스트 한계 시 HTML 시각화

다음 신호 보이면 텍스트 grill 대신 html mock 진입:

- UI 결정 (placement / 모양 / 색 / interaction primitive)
- 복잡한 워크플로우 (multi-step / 분기 / state machine)
- agent 자기 점검: "사용자가 텍스트만으로 컨텍스트 + 옵션 차이 빠르게 잡을까?" 의심 들면 즉시 html

### 작성

- `docs/explorations/<topic>-<date>.html`. vanilla HTML+CSS+inline JS, 의존성 0.
- 같은 데이터 / 같은 상황을 모든 옵션에 동일 적용. 옵션 간 차이만 두드러지게.
- **UI 사소한 모양 (radius / padding / spacing / motion / hover)** → 동적 인터랙션 mock: 슬라이더/토글로 사용자가 만져보며 결정. 정적 비교보다 빠름.
- **워크플로우** → state machine 시각화: 클릭으로 step 진행, 각 step 의 화면/데이터 변화.
- `open <path>` Bash 자동 — 사용자 path 복사 안 해도 됨.
- mock 은 sprint planning input → contract 첨부.

템플릿: `.agents/skills/grill-me/templates/option-comparison.html`.

## 4. 보안 영역 — threat-model 핸드오프 먼저

보안 영향 결정 (password / 암호화 / KDF / 파일 형식 + 외부 공유 / ACL / 서명 / 다중 사용자) 은 options grill 진입 전에 threat-model 핸드오프 작성. 상세: [security-handoff](./security-handoff/memory.md).

## 5. Grill with memory

사용자가 "grill with memory", "memory 반영하며 grill", "결정 문서화하면서 grill"
을 요청하면 일반 grill 룰에 아래를 추가한다.

### 탐색 순서

- 질문하기 전 답이 repo 안에 있는지 먼저 본다: `memory/index/by-surface.md`,
  `memory/index/by-task.md`, 관련 `memory/**/memory.md`, `memory/decisions/memory.md`,
  필요 시 코드.
- 코드/문서로 답할 수 있으면 사용자에게 묻지 않는다. 모순만 surface 한다.
- 기존 memory/ADR 과 용어가 충돌하면 즉시 callout: "기존 결정은 X 인데 지금은 Y 로
  들립니다. 뒤집는 건가요, 범위가 다른 건가요?"

### 저장 라우팅

- 용어 / 도메인 언어: [terminology](../../terminology/memory.md) 에 먼저 저장한다.
- 협업 룰: `/remember` 의 type 매트릭스 ([remember](../../../.agents/skills/remember/SKILL.md))
  로 위치를 계산한다.
- Hard decision: 아래 3조건을 모두 만족할 때만 ADR
  ([decisions](../../decisions/memory.md)) 을 제안/작성한다.
  1. 나중에 뒤집는 비용이 크다.
  2. 맥락 없이 보면 왜 그랬는지 의아하다.
  3. 실제 trade-off 가 있었다.
- Product plan / sequencing 은 `docs/PLAN.md` 또는 `docs/sprints/sprint-N/`.
- 잔여 risk / 감사 follow-up 은 `docs/RISKS.md`.
- UI/flow 비교 mock 은 `docs/explorations/<topic>-<date>.html`.

### 저장 타이밍

- 결정/용어가 lock 되면 바로 저장한다. 세션 끝까지 batch 하지 않는다.
- 위치가 애매하면 한 메시지에 위치 결정 1개만 묻고, 추천 위치를 같이 제시한다.
- `memory/` 를 바꾸면 `bash scripts/regenerate-indexes.sh` 로 index 를 갱신한다.
- ADR 은 본문 동결. 뒤집기는 새 ADR + 원본 frontmatter `Superseded` 만 허용.

## 관련 방

- [security-handoff](./security-handoff/memory.md) — 보안 grill 의 사전 단계
- [bug-fix](../bug-fix/memory.md) — 사용자 보고가 명확치 않을 때 grill 으로 증상 lock 먼저
- [implementation](../implementation/memory.md) — grill lock 후 구현 phase
- [remember](../../../.agents/skills/remember/SKILL.md) — resolved item 저장 라우팅
- [decisions](../../decisions/memory.md) — ADR 작성/동결 규칙
- `.agents/skills/grill-me/` — skill source (트리거 / 템플릿)
- `.agents/skills/grill-with-memory/` — memory 동기화형 grill skill source
