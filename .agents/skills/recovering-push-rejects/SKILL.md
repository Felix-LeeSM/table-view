---
name: recovering-push-rejects
description: push 가 non-fast-forward 로 튕겼을 때의 4-step 회복, race 를 막는 SHA refspec push, closed-PR stale ref 청소. push 가 막히거나 remote SHA 가 낯설 때 읽는다.
---

# push reject 회복

**계약은 `memory/workflow/git-policy/memory.md` 가 소유한다.** 금지 명령 목록과
hard block, 책임 주체는 그 문서가 정한다. 이 파일은 그 계약을 지키면서 막힌 push 를
푸는 **절차**만 담는다. 이 파일과 그 문서가 어긋나면 memory 를 따른다.

아래 어느 단계에서도 `git reset --hard` 의 remote-upstream target 형과 `git pull`
모든 변종은 쓰지 않는다. 시퀀스로 쓰든 두 단계로 쪼개 쓰든 같다.

## 외부 race 가짜 신호 (sprint-402)

push reject 나 알 수 없는 remote SHA 를 "외부 race"(다른 작업자나 다른 brain 의
동시 push)로 오인하는 사례는 거의 100% **본인(agent)의 fetch + reset 또는 pull
자체가 진짜 원인이다**. 즉 race 가 _감지되는 시점_ 에는 이미 본인 명령이 원인을
만든 상태이므로, 외부 race 가설은 가짜 신호다.

실제 진단은 이렇게 한다. push reject 가 나면 reflog(`git reflog --all`)의 직전
entry 가 본인 commit 인지 확인하는데, 거의 항상 본인 commit 이다. 그렇다면 외부
race 가 아니라 _본인의 fetch + reset 으로 ref 가 옮겨진 결과_ 로 생긴 push reject
다.

## Push reject 응급 처치 (sprint-389, sprint-402 update)

push 가 non-fast-forward 로 거부됐을 때 **절대** `git reset --hard FETCH_HEAD`
나 `git pull --rebase` 를 쓰지 마라. 본인 commit 이 지워지거나 조용히 rebase 가
일어난다. 아래가 그 금지 대상이며, 시퀀스로 쓰든 두 단계로 쪼개 쓰든 같다.
race-trace 가 그 2 단계 분리를 push reject 의 진짜 원인으로 확정했다:

- `git reset --hard FETCH_HEAD` / `ORIG_HEAD` / `@{u}` / `origin/<branch>`
  / `refs/remotes/<...>`
- `git pull` 모든 변종 (`--rebase`, `origin <branch>` 포함)

막아 주는 장치는 없다. 위 명령이 머릿속에 떠오르면 그 자체가 진단 신호이므로
아래 4-step 으로 간다.

### 회복 정답 (4-step)

1. **remote 상태 진단**

   ```bash
   git ls-remote origin <branch>     # remote 의 SHA 확인
   ```

2. **본인 reflog 의 직전 commit SHA 확인**

   ```bash
   git reflog                         # 직전 본인 commit SHA 찾기
   ```

3. **ref 만 본인 SHA 로 고친다.** working tree 와 index, commit 은 그대로 보존된다:

   ```bash
   git update-ref refs/heads/<branch> <local-sha>
   ```

4. **SHA refspec 을 인라인으로 지정해 push 한다.** race 가 발생해도 의도한
   commit 만 올라간다:

   ```bash
   SHA="$(git rev-parse HEAD)"
   git push origin "$SHA":refs/heads/<branch>
   ```

closed-PR stale ref 가 의심되면 (PR close 시 `--delete-branch` 누락):
`gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>` 후 재시도.
여전히 안 풀리면 force/reset 을 시도하지 말고 상황 보고 후 별도
복구 절차를 합의한다.

## SHA refspec push 패턴 (sprint-389)

agent 가 작업 중에 새 commit 을 만든 뒤 push 하기 직전에 _다른_ 에이전트
세션이 같은 branch 에 push 해버리는 race 가 가능. 이 race 를 막기 위한
SHA refspec push 패턴:

```bash
git rev-parse HEAD                                          # 1) 로컬 SHA 확보
git push origin '<literal-sha>':'refs/heads/<branch-name>'  # 2) literal SHA → branch
```

### Why

- `git push origin HEAD:branch` 는 push 시점 `HEAD` 가 무엇이든 거기를
  올림 → race 발생 가능.
- literal SHA 를 명시하면 SHA-to-ref mapping 이 결정적이 된다. race 가
  발생해도 의도한 commit 만 올라가고, 그 사이 새 commit 이 추가됐다면 push 가
  자동으로 reject 되므로(non-fast-forward) 사용자가 진단할 수 있다.

### zsh `:r` 모디파이어 trap

zsh 는 word 안의 `:` 를 modifier 로 해석 → `<sha>:refs/heads/foo` 가
깨짐. **single-quote escape 필수** (bash 에선 무해): `git push origin
'abc1234':'refs/heads/feat/foo'`.

## PR close cleanup (sprint-389)

`gh pr close` 시 **반드시** `--delete-branch` 동반. closed-PR 의 head ref 가
remote 에 stale 로 남으면, 같은 작업이 재 spawn 될 때 새 branch 의 SHA 와
non-fast-forward 충돌 → push reject. 누락을 경고해 주는 것은 없다.

```bash
gh pr close <N> --delete-branch --comment "<reason>"
```

### 재 spawn 시 stale ref 검증

새 사본(clone) / 새 branch 작업 시작 전:

```bash
# remote 에 같은 branch ref 가 살아있는지 검사
git ls-remote origin <branch>

# stale 발견 시 삭제
gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>
```

## 관련

- `memory/workflow/git-policy/memory.md`: 이 절차가 지켜야 하는 계약(금지 명령 ·
  hard block · 책임 주체)이 있고, 그 계약이 SOT 다.
- `memory/runbook/worktree/memory.md`: 사본 격리 lifecycle 이 있으며, 집행 장치가
  없는 것도 같다.
- `memory/workflow/delivery/memory.md`: push 이후의 PR 생성과 리뷰, 머지 계약이 있다.
