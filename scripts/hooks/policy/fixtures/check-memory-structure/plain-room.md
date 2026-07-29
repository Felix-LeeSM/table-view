---
fixture: memory/workflow/memory.md
expect: accept
---

# A plain room

The negative control. Without at least one input the guard must let through,
every assertion in the sweep is satisfied by a guard that exits 1 on everything
— green, and worth nothing.

This also pins the root exemption: `memory/` itself has a child directory and no
`memory/memory.md`, and that is not a violation.
