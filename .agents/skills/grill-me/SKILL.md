---
name: grill-me
description: 공유된 이해에 도달할 때까지 사용자에게 계획이나 설계에 대해 끈질기게 인터뷰. 결정 트리의 모든 분기를 해결. 사용자가 계획을 압박 테스트하고 싶거나, 설계를 그릴링 받고 싶거나, "그릴링", "grill me"를 언급할 때 사용.
---

# grill-me

이 계획의 모든 측면에 대해 공유된 이해에 도달할 때까지 끈질기게 인터뷰해.
설계 트리의 각 분기를 따라가면서, 결정 사이의 의존성을 하나씩 해결해.

질문은 한 번에 하나씩 해.

각 질문은 결정 1개 + 옵션 + 추천 답변 + 짧은 이유로 구성한다. 의존 후속
결정이 보여도 답을 받은 뒤 다음 질문으로 넘어간다. 사용자가 명시적으로
"묶어서 진행"하라고 할 때만 여러 결정을 한 메시지에 묶는다.

코드베이스를 탐색하면 답할 수 있는 질문이라면, 직접 코드베이스를 탐색해.

## 옵션 분해

옵션은 항상 두 축으로 점검한다.

- 기술 축: 구현 비용, 위험, 의존성, 유지 부담.
- 유저 플로우 축: task 빈도, 가치, 막히는 지점, 이미 다른 결정으로
  커버되는지.

한 축에서 동등하면 다른 축으로 나누고, 두 축 모두 동등하면 옵션에서 제거한다.
각 옵션은 "사용자 task 가 어떻게 달라지는가"와 "비용/위험이 어떻게 다른가"를
같이 설명한다.

## 텍스트 한계 시 시각화

다음 신호가 있으면 텍스트 질문만 반복하지 말고 HTML mock 을 만든다.

- UI 결정: placement, shape, color, interaction primitive.
- 복잡한 workflow: multi-step, branch, state machine.
- 사용자가 텍스트만으로 옵션 차이를 빠르게 잡기 어렵다고 판단될 때.

위치: `docs/explorations/<topic>-<date>.html`. Vanilla HTML/CSS/inline JS,
의존성 0. 같은 데이터/상황을 모든 옵션에 적용하고 옵션 간 차이만 드러낸다.
UI 미세 결정은 slider/toggle 같은 동적 비교를 우선한다. workflow 는 클릭으로
step 을 진행하는 state machine mock 이 좋다.

## 보안 결정

보안 영향 결정은 일반 options grill 로 바로 들어가지 않는다. password,
credential, 암호화, KDF, nonce/IV, key derivation, 파일 형식 + 외부 공유, 권한,
ACL, 코드 서명, supply-chain, 다중 사용자 신호가 있으면 먼저 threat-model
handoff 를 작성한다.

Threat-model handoff 는 `docs/threat-models/<topic>-<date>.md` 에 두고, 다음
6 섹션을 포함한다.

1. 자산: 보호 대상.
2. 위협: 외부 공격, 내부 실수, 사이드채널, supply-chain.
3. 현재 인프라 정밀 분석: 이미 구현된 encryption/auth 경로, KDF 파라미터,
   키 저장 위치와 권한.
4. 사용자 실수 시나리오: 평문 파일 commit, Slack 첨부, sync, indexing 등.
5. 완화: 각 옵션이 어떤 위협에 어떻게 대응하는지.
6. 잔여 위험: 사용자가 받아들여야 할 trade-off.

사용자 informed consent 후에야 옵션 grill 로 들어간다.
