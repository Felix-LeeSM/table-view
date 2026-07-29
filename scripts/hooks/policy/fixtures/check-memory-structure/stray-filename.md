---
fixture: memory/workflow/notes.md
expect: reject
mentions: memory/workflow/notes.md
---

# Stray filename

The guard's first rejection path: a file under `memory/` whose basename is not
`memory.md`. Nothing else about this file matters — the guard reads names, not
content.
