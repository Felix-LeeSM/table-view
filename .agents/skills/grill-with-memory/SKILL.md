---
name: grill-with-memory
description: Memory 동기화형 grill. 계획/설계를 압박 테스트하면서 active memory/docs와 코드에 맞춰 용어·결정을 즉시 정리. 사용자가 "grill with memory", "memory 반영하며 grill", "결정 문서화하면서 그릴링"을 요청할 때 사용.
---

Read:
1. `AGENTS.md`
2. `.agents/skills/grill-me/SKILL.md`
3. durable write 필요 시 `.agents/skills/remember/SKILL.md`

`grill-me` 의 결정 인터뷰 규칙에 아래 memory 동기화 규칙을 추가한다.

용어/룰은 `memory/**/memory.md`, 현재 제품 상태와 제한은 `docs/product/`,
미래 목표는 `docs/ROADMAP.md`, hard decision 이력은
`docs/archives/decisions/*/memory.md`, sprint 산출물은 기존 `docs/` SOT 로
라우팅한다.

질문은 한 번에 결정 1개만 한다. 각 질문은 옵션 + 추천 답을 포함한다. 코드나
기존 memory 로 답할 수 있으면 먼저 탐색한다. 용어/룰/결정이 lock 되면 즉시 해당
source 를 갱신하고, `memory/` 변경 시 `bash scripts/regenerate-indexes.sh` 를 실행한다.

## 탐색 순서

- 질문하기 전 답이 repo 안에 있는지 먼저 본다: `memory/index/by-surface.md`,
  `memory/index/by-task.md`, 관련 `memory/**/memory.md`, `docs/product/README.md`,
  `docs/ROADMAP.md`, 필요 시 코드.
- Archived ADR 은 기본 입력이 아니다. 과거 결정 출처가 필요하거나 hard decision
  충돌을 점검할 때만 `docs/archives/decisions/memory.md` 를 본다.
- 코드/문서로 답할 수 있으면 사용자에게 묻지 않는다. 모순만 surface 한다.
- 기존 memory/ADR 과 용어가 충돌하면 즉시 callout 한다.

## 저장 라우팅

- 용어 / 도메인 언어 / 협업 룰: `remember` skill 의 type 매트릭스로 위치를 계산한다.
- Hard decision 은 아래 3조건을 모두 만족할 때만 ADR 을 제안/작성한다.
  1. 나중에 뒤집는 비용이 크다.
  2. 맥락 없이 보면 왜 그랬는지 의아하다.
  3. 실제 trade-off 가 있었다.
- Product 상태와 사용자-visible 제한은 `docs/product/`, 미래 목표와 sequencing
  후보는 `docs/ROADMAP.md`, sprint evidence 는 `docs/sprints/sprint-N/`.
- 구조적 제약은 architecture SOT, 개발/운영 검증 제약은
  `docs/contributor-guide/`, 과거 risk register 는 `docs/archives/risks/`.
- UI/flow 비교 mock 은 `docs/explorations/<topic>-<date>.html`.
