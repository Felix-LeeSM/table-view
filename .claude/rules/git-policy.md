---
paths:
  - "**"
---

# Git 정책 wrapper

Source: [`memory/workflow/git-policy/memory.md`](../../memory/workflow/git-policy/memory.md).

요지: hook/signing 우회, `LEFTHOOK=0`, `git push --force` (사용자 승인 없이) 금지.
hook 실패 시 회피 X, 근본 fix. 자세한 강제 메커니즘 / 예외 / 책임 주체는 source.
