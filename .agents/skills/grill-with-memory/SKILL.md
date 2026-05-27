---
name: grill-with-memory
description: Memory/docs 동기화형 grill. 계획/설계를 압박 테스트하면서 active memory, docs, 코드에 맞춰 용어·결정·현재/미래 상태를 즉시 정리. 사용자가 "grill me", "그릴링", "grill with memory", "memory/docs 반영하며 grill", "결정 문서화하면서 그릴링"을 요청할 때 사용.
---

# Grill With Memory

Read:

1. `AGENTS.md`
2. 질문 주제의 관련 active memory/docs/code
3. durable memory write 필요 시 `.agents/skills/remember/SKILL.md`

공유된 이해에 도달할 때까지 계획/설계를 압박 테스트한다. 결정이 lock 되면
memory 만 갱신하지 말고, 필요한 docs SOT 도 즉시 갱신한다.

## 기본 인터뷰 규칙

- 질문은 한 번에 결정 1개만 한다.
- 각 질문은 결정 1개 + 옵션 + 추천 답변 + 짧은 이유로 구성한다.
- 의존 후속 결정이 보여도 답을 받은 뒤 다음 질문으로 넘어간다.
- 사용자가 명시적으로 "묶어서 진행"하라고 할 때만 여러 결정을 한 메시지에 묶는다.
- 코드베이스, active memory, docs 로 답할 수 있는 질문이면 먼저 직접 탐색한다.

## 탐색 순서

- 질문하기 전 답이 repo 안에 있는지 먼저 본다: `memory/index/by-surface.md`,
  `memory/index/by-task.md`, 관련 `memory/**/memory.md`, `docs/product/README.md`,
  `docs/ROADMAP.md`, 필요 시 코드.
- Archived ADR 은 기본 입력이 아니다. 과거 결정 출처가 필요하거나 hard decision
  충돌을 점검할 때만 `docs/archives/decisions/memory.md` 를 본다.
- 코드/문서로 답할 수 있으면 사용자에게 묻지 않는다. 모순만 surface 한다.
- 기존 memory/ADR 과 용어가 충돌하면 즉시 callout 한다.

## 옵션 분해

옵션은 항상 두 축으로 점검한다.

- 기술 축: 구현 비용, 위험, 의존성, 유지 부담.
- 유저 플로우 축: task 빈도, 가치, 막히는 지점, 이미 다른 결정으로 커버되는지.

한 축에서 동등하면 다른 축으로 나누고, 두 축 모두 동등하면 옵션에서 제거한다.
각 옵션은 "사용자 task 가 어떻게 달라지는가"와 "비용/위험이 어떻게 다른가"를 같이
설명한다.

## 텍스트 한계 시 시각화

다음 신호가 있으면 텍스트 질문만 반복하지 말고 HTML mock 을 만든다.

- UI 결정: placement, shape, color, interaction primitive.
- 복잡한 workflow: multi-step, branch, state machine.
- 사용자가 텍스트만으로 옵션 차이를 빠르게 잡기 어렵다고 판단될 때.

위치: `docs/explorations/<topic>-<date>.html`. Vanilla HTML/CSS/inline JS,
의존성 0. 같은 데이터/상황을 모든 옵션에 적용하고 옵션 간 차이만 드러낸다.
UI 미세 결정은 slider/toggle 같은 동적 비교를 우선한다. workflow 는 클릭으로
step 을 진행하는 state machine mock 이 좋다. 시작점이 필요하면
`.agents/skills/grill-with-memory/templates/option-comparison.html` 를 사용한다.

## 보안 결정

보안 영향 결정은 일반 options grill 로 바로 들어가지 않는다. password,
credential, 암호화, KDF, nonce/IV, key derivation, 파일 형식 + 외부 공유, 권한,
ACL, 코드 서명, supply-chain, 다중 사용자 신호가 있으면 먼저 threat-model
handoff 를 작성한다.

Threat-model handoff 는 필요할 때 `docs/explorations/<topic>-threat-model-<date>.md`
에 임시 산출물로 둔다. decision 이 lock 되면 아래 저장 라우팅에 따라
product/roadmap/architecture/contributor/archives SOT 로 흡수한다. handoff 는 다음
6 섹션을 포함한다.

1. 자산: 보호 대상.
2. 위협: 외부 공격, 내부 실수, 사이드채널, supply-chain.
3. 현재 인프라 정밀 분석: 이미 구현된 encryption/auth 경로, KDF 파라미터,
   키 저장 위치와 권한.
4. 사용자 실수 시나리오: 평문 파일 commit, Slack 첨부, sync, indexing 등.
5. 완화: 각 옵션이 어떤 위협에 어떻게 대응하는지.
6. 잔여 위험: 사용자가 받아들여야 할 trade-off.

사용자 informed consent 후에야 옵션 grill 로 들어간다.

## 저장 라우팅

- 용어 / 도메인 언어 / 협업 룰: `remember` skill 의 type 매트릭스로 위치를 계산한다.
- Hard decision 은 아래 3조건을 모두 만족할 때만 ADR 을 제안/작성한다.
  1. 나중에 뒤집는 비용이 크다.
  2. 맥락 없이 보면 왜 그랬는지 의아하다.
  3. 실제 trade-off 가 있었다.
- Product 상태와 사용자-visible 제한은 `docs/product/`.
- 미래 목표, roadmap 크기의 미완/계획, sequencing 후보는 `docs/ROADMAP.md`.
- 작은 active routing/compatibility note 만 `docs/PLAN.md`; PLAN 을 backlog 로 만들지 않는다.
- Sprint evidence 는 `docs/sprints/sprint-N/`.
- 구조적 제약은 architecture SOT, 개발/운영 검증 제약은
  `docs/contributor-guide/`, 과거 risk register 는 `docs/archives/risks/`.
- UI/flow 비교 mock 은 `docs/explorations/<topic>-<date>.html`.
- 과거 사건/결정은 기본 memory 로 올리지 말고 `docs/archives/**` 로 보낸다.

`memory/` 변경 시 `bash scripts/regenerate-indexes.sh` 를 실행한다. docs 를 바꿨으면
링크/format 검증을 함께 수행한다.
