---
name: grill-with-memory
description: Memory 동기화형 grill. 계획/설계를 압박 테스트하면서 repo memory/ADR/docs와 코드에 맞춰 용어·결정을 즉시 정리. 사용자가 "grill with memory", "memory 반영하며 grill", "결정 문서화하면서 그릴링"을 요청할 때 사용.
---

Read:
1. `AGENTS.md`
2. `memory/workflow/grill/memory.md`
3. durable write 필요 시 `.agents/skills/remember/SKILL.md` 와 `memory/decisions/memory.md`

`memory/workflow/grill/memory.md` 의 "Grill with memory" 섹션을 따른다.

용어/룰은 `memory/**/memory.md`, hard decision 은 `memory/decisions/*/memory.md`,
plan/risk/sprint 산출물은 기존 `docs/` SOT 로 라우팅한다.

질문은 한 번에 결정 1개만 한다. 각 질문은 옵션 + 추천 답을 포함한다. 코드나
기존 memory 로 답할 수 있으면 먼저 탐색한다. 용어/룰/결정이 lock 되면 즉시 해당
source 를 갱신하고, `memory/` 변경 시 `bash scripts/regenerate-indexes.sh` 를 실행한다.
