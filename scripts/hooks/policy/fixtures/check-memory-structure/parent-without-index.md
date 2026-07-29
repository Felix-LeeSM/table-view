---
fixture: memory/parent/child/memory.md
expect: reject
mentions: memory/parent
---

# Parent without an index

The guard's second rejection path: `memory/parent` has a child directory and no
`memory.md` of its own. One file states it, because creating this one creates
both directories.

`mentions` is the parent, not this file's path — the guard names the directory
that is missing its index. A case that only asserted "exit 1" would pass here on
the first rejection path alone and stop noticing this one.
