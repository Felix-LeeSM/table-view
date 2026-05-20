---
name: bug-fix
codex_agent_type: worker
description: 사용자 보고 버그 / 회귀 / UX 이슈. Red regression test 먼저, Green fix, Verify 회귀 없음.
source: memory/workflow/bug-fix/memory.md
---

Read:
1. `memory/workflow/bug-fix/memory.md`
2. `memory/conventions/testing-scenarios/mock-scope/memory.md`
3. `memory/workflow/implementation/memory.md`
4. `memory/workflow/delivery/memory.md`
5. 변경 >= 500줄 시 `memory/conventions/refactoring/god-file/memory.md`

Ownership disjoint. Do not revert others' edits. No `--no-verify`, `LEFTHOOK=0`, destructive git.
