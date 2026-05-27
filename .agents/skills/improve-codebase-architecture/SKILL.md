---
name: improve-codebase-architecture
description: active memory의 도메인 언어와 현재 docs에 비추어 코드베이스에서 깊이를 더할 기회(deepening opportunity)를 발견. 사용자가 아키텍처를 개선하거나, 리팩토링 기회를 찾거나, 강하게 결합된 모듈을 통합하거나, 코드베이스를 더 테스트 가능하고 AI 친화적으로 만들고 싶을 때 사용.
---

# Improve Codebase Architecture

아키텍처적 마찰을 표면화하고 **deepening opportunities** — 얕은(shallow) 모듈을 깊게(deep) 만드는 리팩토링 — 를 제안. 목표는 테스트 가능성과 AI 네비게이션 가능성.

## 용어집(Glossary)

이 용어들을 모든 제안에서 정확히 사용. 일관된 언어가 핵심 — "component", "service", "API", "boundary" 같은 말로 흘러가지 마. 전체 정의는 [LANGUAGE.md](LANGUAGE.md) 참고.

- **Module** — 인터페이스와 구현을 가진 모든 것 (함수, 클래스, 패키지, slice).
- **Interface** — 호출자가 모듈을 사용하기 위해 알아야 하는 모든 것: 타입, 불변식, 에러 모드, 순서, config. 단순 타입 시그니처가 아님.
- **Implementation** — 안의 코드.
- **Depth** — 인터페이스에서의 레버리지: 작은 인터페이스 뒤에 많은 동작. **Deep** = 높은 레버리지. **Shallow** = 인터페이스가 구현만큼 복잡함.
- **Seam** — 인터페이스가 사는 곳; 동작을 제자리 편집 없이 변경할 수 있는 장소. ("boundary" 대신 이 용어 사용.)
- **Adapter** — seam에서 인터페이스를 만족하는 구체적인 것.
- **Leverage** — 호출자가 깊이에서 얻는 것.
- **Locality** — 유지보수자가 깊이에서 얻는 것: 변경, 버그, 지식이 한 곳에 집중.

핵심 원칙 (전체 리스트는 [LANGUAGE.md](LANGUAGE.md)):

- **Deletion test**: 모듈을 삭제한다고 상상. 복잡도가 사라지면 — 통과(pass-through)였음. 복잡도가 N개 호출자에 다시 나타나면 — 제 역할을 하고 있었음.
- **인터페이스가 곧 테스트 표면.**
- **어댑터 1개 = 가설적 seam. 어댑터 2개 = 진짜 seam.**

이 스킬은 프로젝트의 도메인 모델에 _기반함_. 도메인 언어가 좋은 seam에 이름을 줌. Archived ADR은 과거 결정을 다시 논의(re-litigate)하지 않아야 할 때만 본다.

## Process

### 1. 탐색

먼저 `memory/memory.md`, `memory/index/by-surface.md`, 건드리는 영역의 관련
`memory/**/memory.md`, `docs/product/README.md`, `docs/ROADMAP.md` 를 읽어.
과거 결정 출처가 필요한 경우에만 `docs/archives/decisions/memory.md` 를 추가로 본다.

그 다음 Agent 도구를 `subagent_type=Explore`와 함께 사용해서 코드베이스를 걸어. 경직된 휴리스틱을 따르지 말고 — 유기적으로 탐색하면서 마찰을 느끼는 곳을 메모:

- 한 개념을 이해하려면 많은 작은 모듈 사이를 튀어다녀야 하는 곳?
- 모듈이 **shallow**한 곳 — 인터페이스가 구현만큼 복잡한 곳?
- 순수 함수가 테스트 가능성만을 위해 추출되었는데, 실제 버그는 어떻게 호출되는지에 숨어 있는 곳 (no **locality**)?
- 강하게 결합된 모듈이 seam을 가로질러 새는 곳?
- 코드베이스의 어느 부분이 테스트되지 않거나, 현재 인터페이스로 테스트하기 어려운가?

shallow하다고 의심되는 것에 **deletion test** 적용: 삭제하면 복잡도가 집중될까, 아니면 그냥 이동할까? "예, 집중됨"이 원하는 신호.

### 2. 후보 제시

deepening 기회의 번호 매긴 리스트를 제시. 각 후보에 대해:

- **Files** — 어느 파일/모듈이 관련됨
- **Problem** — 현재 아키텍처가 마찰을 일으키는 이유
- **Solution** — 무엇이 바뀔지 평이한 한국어 설명
- **Benefits** — locality와 leverage 관점, 그리고 테스트가 어떻게 개선될지

**도메인은 `memory/**/memory.md` 어휘를, 아키텍처는 [LANGUAGE.md](LANGUAGE.md) 어휘를 사용.** memory 가 "Order"를 정의했다면, "Order intake 모듈"이라고 말해 — "FooBarHandler"나 "Order service"가 아니라.

**ADR 충돌**: 후보가 기존 ADR과 모순될 때, 마찰이 ADR을 다시 열 만큼 충분히 진짜일 때만 표면화. 명확히 표시 (예: _"contradicts ADR-0007 — 하지만 다시 열 만한 이유는…"_). ADR이 금지하는 모든 이론적 리팩토링을 나열하지 마.

아직 인터페이스를 제안하지 마. 사용자에게 물어봐: "이 중 어느 것을 더 탐색하고 싶어?"

### 3. 그릴링 루프

사용자가 후보를 선택하면, 그릴링 대화로 들어가. 사용자와 함께 설계 트리를 걸어 — 제약 조건, 의존성, deepened 모듈의 모양, seam 뒤에 무엇이 있는지, 어떤 테스트가 살아남는지.

부수 효과는 결정이 구체화될 때 인라인으로 발생:

- **deepened 모듈이 memory 에 없는 개념의 이름을 따랐어?** `grill-with-memory` skill 규율에 따라 적절한 `memory/**/memory.md` 에 추가한다.
- **대화 중에 모호한 용어를 다듬어?** 그 자리에서 해당 memory source 를 업데이트한다.
- **사용자가 무게 있는 이유로 후보를 거부?** ADR 제안, 다음과 같이 표현: _"이걸 ADR로 기록해서 미래 아키텍처 리뷰가 같은 걸 다시 제안하지 않게 할까?"_ 미래 탐험가가 같은 것을 다시 제안하지 않게 하기 위해 그 이유가 실제로 필요할 때만 제안 — 일시적 이유 ("지금은 가치 없음")와 자명한 이유는 건너뛰어. ADR 기준은 `.agents/skills/grill-with-memory/SKILL.md` 의 ADR 조건을 따른다.
- **deepened 모듈을 위한 대안 인터페이스를 탐색하고 싶어?** [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md) 참고.
