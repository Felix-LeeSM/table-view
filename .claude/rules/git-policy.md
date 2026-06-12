---
paths:
  - "**"
---

# Git 정책 wrapper

Source: [`memory/workflow/git-policy/memory.md`](../../memory/workflow/git-policy/memory.md).

요지: `--no-verify`, `--no-gpg-sign`, `LEFTHOOK=0`, `HUSKY=0`, agent path 의
`git push --force` 금지. hook 실패 시 회피 X, 근본 fix. 자세한 hard-block /
책임 주체는 source.
