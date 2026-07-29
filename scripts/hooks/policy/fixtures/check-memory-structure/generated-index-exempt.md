---
fixture: memory/index/by-surface.md
expect: accept
---

# The generated index is exempt

`memory/index/*.md` is written by `scripts/regenerate-indexes.sh`, so the
memory.md-only rule skips it. This is the one carve-out in the guard, and it is
the piece a rewrite of the first rejection path is most likely to drop: the
naive "every file under memory/ must be memory.md" rule is shorter, still
rejects `stray-filename.md`, and turns every index regeneration into a blocked
push.
