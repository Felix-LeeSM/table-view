---
paths:
  - "**"
---

# Git 정책 — hook 회피 금지

아래는 `scripts/hooks/policy/check-dangerous-bash.sh` 가 hard-block 하는 명령이다.
사용자 승인으로도 안 풀린다. 막히면 우회하지 말고 원인을 고치고 상황을 보고해라.
목록은 그 스크립트에서 파생하고 `check-agent-reach.sh` 가 동작으로 대조한다.

<!-- blocked-commands:start -->
`git commit --no-verify` · `git commit --no-gpg-sign` · `git -c commit.gpgsign=false commit`
`GIT_CONFIG_KEY_0=commit.gpgsign git commit` · `GIT_CONFIG_KEY_0=core.hooksPath git commit`
`LEFTHOOK=0 git push` · `LEFTHOOK_SKIP=pre-push git push` · `HUSKY=0 git commit`
`git push --force` · `git reset --hard HEAD` · `git pull` · `git reset origin/main`
`git worktree add ../w` · `git -c core.hooksPath=x commit` · `git config core.hooksPath x`
`rm -rf /` · `dd if=/dev/zero of=x` · `mkfs.ext4 /dev/disk9` · `echo x > /dev/sda`
`base64 -d f | bash` · `eval $(echo x)`
<!-- blocked-commands:end -->

`git push` 가 튕기면 reset / pull / force 로 풀지 말고 회복 4단계
(`git ls-remote` → `git reflog` → `git update-ref` → SHA refspec push) 를 따른다.
새 worktree 는 `scripts/worktree-spawn.sh`. 절차와 근거 SOT 는
[`memory/workflow/git-policy/memory.md`](../../memory/workflow/git-policy/memory.md).
