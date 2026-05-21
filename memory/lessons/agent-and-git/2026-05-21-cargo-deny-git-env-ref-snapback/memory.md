---
title: cargo-deny nested git inherited hook env and snapped worktree refs
type: lesson
updated: 2026-05-21
task: git, hook, pre-push, push-reject, worktree, cargo-deny, root-cause
surface: lefthook.yml, scripts/worktree-spawn.sh, scripts/hooks/test-worktree-push-ref-safety.sh
---

# cargo-deny nested git inherited hook env and snapped worktree refs

상황: linked worktree branch push 직후 local branch ref 가 agent commit 에서
`FETCH_HEAD` SHA 로 되돌아간 것처럼 보였다. remote 는 agent commit 을 받은
상태였고, local reflog 만 `reset: moving to FETCH_HEAD` 를 기록했다.

원인: pre-push `cargo-deny` 가 advisory DB 갱신 중 nested Git 을 실행했고,
hook 의 outer repo Git-local env 를 상속했다. nested Git 이 advisory DB 대신
outer worktree metadata 를 바라보며 reset 을 수행해 branch ref 를 움직였다.

재발 방지: hook 안에서 nested Git 을 실행할 수 있는 도구는 먼저
`unset $(git rev-parse --local-env-vars)` 로 outer Git env 를 끊는다. 새
worktree branch 는 remote branch 가 생기기 전까지 `origin/main` upstream 을
갖지 않게 한다.

진단 신호:

- reflog 에 local commit 직후 같은 branch 의 `reset: moving to FETCH_HEAD`
  가 찍힘.
- remote ref 는 intended local commit 으로 업데이트되어 있음.
- 이 경우 외부 race 보다 hook/nested Git env 오염을 먼저 의심한다.

고정 가드:

- `lefthook.yml` `4_cargo-deny` 는 Git-local env 를 unset 한다.
- `scripts/worktree-spawn.sh` 는 새 branch 생성 후 upstream 을 unset 한다.
- `scripts/hooks/test-worktree-push-ref-safety.sh` 가 두 invariant 를 검사한다.
