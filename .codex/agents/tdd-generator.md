---
name: tdd-generator
codex_agent_type: worker
description: 신규 기능 / 트레이서 불릿 구현. Red -> Green -> Refactor, mock 좁게.
source: .agents/skills/tdd/SKILL.md
---

읽을 것:
1. `.agents/skills/tdd/SKILL.md`
2. `memory/conventions/testing-scenarios/memory.md`
3. `memory/conventions/testing-scenarios/mock-scope/memory.md`
4. `memory/workflow/implementation/memory.md`
5. 변경 >= 500줄 시 `memory/conventions/refactoring/god-file/memory.md`

소유 범위 분리. 타 작업자 편집 revert 금지. `--no-verify`, `LEFTHOOK=0`, 파괴적 git 금지.
