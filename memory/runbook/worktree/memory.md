---
title: "작업 사본 격리: clone"
type: runbook
updated: 2026-08-27
task: clone, worktree, multi-agent, parallel, spawn-verify, agent-hard-rule
keywords: index.lock, FETCH_HEAD, git fetch, git clone --local, 사본, 격리, cross-worktree, getcwd, 회수, dirty, 브랜치 점유, non-fast-forward, push reject, stalled, timeout, respawn, npx, pnpm exec, cargo clean, stale path, 일회용 사본, 리뷰어 사본, PR head, headRefOid, gh pr checkout, checkout --detach, review__, --depth, shallow clone, is-shallow-repository, --unshallow, bad object
---

# 작업 사본 격리: clone

여러 agent 가 같은 저장소에서 병렬로 작업할 때에는 **독립된 clone** 으로 서로를
격리한다. 작업 하나는 PR 하나에 대응하고, 그 작업마다 사본을 하나씩 만든다.

2026-07-31 에 사용자가 `git worktree add` 대신 clone 을 쓰기로 결정했다(#2035
결정 7). linked worktree 는 `.git` 을 공유하기 때문에 index.lock 이 겹치거나
FETCH_HEAD 같은 공유 자원이 충돌하는 현상을 실제로 관측했고, 한 작업이 공유
설정인 hooksPath 를 바꾸면 병렬로 도는 작업 전체에서 훅이 꺼지는 사고 유형도
있었다(#1860). clone 은 `.git` 이 완전히 독립이라서 이 사고 유형이 통째로
사라진다. 기존 `worktrees/` 는 새로 만들지 않고, 이미 남아 있는 것에는 회수
절차만 적용한다.

**도구와 가드는 없다.** 아래 절차는 전부 손으로 밟아야 하고, 어겨도 막아 주는
장치가 없다.

## 소유권 / SOT

- 사본을 만들고 점유하고 회수하는 일은 이 파일이 유일한 SOT 로서 소유한다.
  예외는 아래에서 다른 소유자를 지명한 항목뿐이다.
- commit 과 push, PR, merge 의 행동 계약은
  [delivery](../../workflow/delivery/memory.md) 가 소유하고, push reject 의
  계약은 [git-policy](../../workflow/git-policy/memory.md) 가 소유하며, 회복
  절차는
  [recovering-push-rejects](../../../.agents/skills/recovering-push-rejects/SKILL.md)
  가 소유한다.
- 리뷰어가 쓰는 **일회용 사본**도 이 파일이 소유한다. 만드는 방법은 아래
  「리뷰어 사본」에 있고, 지워야 하는 의무는 아래 「책임」에 있다. 언제 어느
  노드가 만드는지는 [review](../../workflow/review/memory.md) 「행동 계약」이
  정한다. 일회용 사본은 작업 사본과 별개다.

## 생성

```bash
# primary 루트에서 실행 — 사본은 primary "밖" 형제 디렉토리에 만든다
PRIMARY="$(git rev-parse --show-toplevel)"
DEST="$PRIMARY/../table-view-clones/<branch 의 / 를 __ 로>"
# 1) GitHub 에서 clone — primary 를 소스로 쓰지 않는다 (아래 「사본은 얕으면 안 된다」).
#    https 인 이유: 이 머신의 ssh 는 GitHub 인증이 없어 fetch 가 실패한다 (2026-07-31 실측)
git clone https://github.com/Felix-LeeSM/table-view.git "$DEST"
DEST="$(cd "$DEST" && pwd -P)"   # `..` 정규화 — 첫 turn 검증(rev-parse)의 문자열 비교와 일치시킨다
test "$(git -C "$DEST" rev-parse --is-shallow-repository)" = false \
  || { echo "ABORT: 역사가 잘린 사본" >&2; exit 1; }
# 2) 브랜치
git -C "$DEST" checkout -b <branch> origin/main
# 3) 의존성 — cold 시작
cd "$DEST" && pnpm install --frozen-lockfile --prefer-offline
```

- **사본은 얕으면 안 된다. clone 의 소스는 primary 가 아니라 GitHub 이다.**
  primary 자체가 shallow 이기 때문에(경계 커밋은 `539d05f3` 이고 2026-06-11 에
  생겼다) `git clone --local` 은 `--local` 을 무시하고 그 경계까지만 복제한다.
  2026-08-10 에 실제로 재 보니 `git rev-list --count 0da61f06` 이 그렇게 만들어진
  사본에서는 778 을 냈고, GitHub 에서 clone 한 사본에서는 1921 을 냈다. 역사가
  잘려도 오류가 나지 않고 정상으로 보이는 숫자가 나오기 때문에, 위 `test` 로
  판정한다. `--depth` 도 같은 이유로 금지한다. `--depth 1` 로 만들면
  `scripts/sweep/core-split-prose.mjs` 가 참조하는 고정 커밋이 없어서 `pnpm test`
  가 실패한다. CI 도 같은 이유로 `frontend-shard` 잡에 `fetch-depth: 0` 을 준다.
- 사본은 primary **바깥**의 형제 디렉토리인 `../table-view-clones/` 에 만든다.
  저장소 안에 두면 rg 와 Tailwind 의 소스 스캔, lint 글롭이 사본까지 훑게 되고,
  `.gitignore` 만으로는 그 도구들을 전부 막지 못한다.
- `src-tauri/target/` 과 `node_modules/` 는 복사하지 않는다. 복사한 디렉토리에
  남아 있던 stale path 가 tauri 빌드를 깨뜨린 적이 있다. 사본은 의존성을 새로
  설치하는 cold 상태로 시작한다. 이미 warm-copy 잔재 때문에 tauri 검사가 stale
  path 를 참조하고 있다면 `cargo clean` 이 근본적인 해결책이다.
- core.hooksPath 를 비롯한 hook 설정도 사본마다 독립이므로, 한 사본에서 바꾼
  설정이 다른 사본에는 영향을 주지 않는다.
- 사본 안에서 도구를 실행할 때에는 **버전을 고정한다.** `pnpm exec <도구>` 나
  `npx <pkg>@<버전>` 형태를 쓴다. 버전을 붙이지 않은 `npx biome` 가 이름만 같고
  관계는 없는 패키지를 내려받아서 거짓 통과를 낸 사례를 2026-07-31 에 관측했다.

## 리뷰어 사본: PR head 를 체크아웃한다

위 「생성」 절차는 구현자를 위한 것이라서 `origin/main` 을 체크아웃한다. 리뷰어가
그 절차를 그대로 쓰면 **PR 의 변경이 하나도 들어 있지 않은 트리**에서 test 와
lint, build 를 돌리고 그 출력을 scorecard 의 근거로 인용하게 된다. 그 출력은
통과든 실패든 아무 의미가 없는데, 출력 어디에도 그 사실이 드러나지 않는다. 사본을
만들 조건은 [review](../../workflow/review/memory.md) 「행동 계약」이 정하고,
지워야 하는 의무는 아래 「책임」이 정한다.

```bash
PR=<PR 번호>
AUTHOR="<spawn 이 준 저자 사본 경로>"   # 첫 turn 검증에 쓴 그 문자열. 경로 계산에만 쓴다
case "$AUTHOR" in /*) ;; *) echo "ABORT: AUTHOR 는 절대경로여야 한다" >&2; exit 1;; esac
OID="$(gh pr view "$PR" --repo Felix-LeeSM/table-view --json headRefOid -q .headRefOid)"
DEST="$(mktemp -d "$(dirname "$AUTHOR")/review__${PR}__${OID:0:12}__XXXXXX")"
git init -q "$DEST"
printf '%s\n' "$DEST" > "$DEST/.git/.review-clone"   # 소유 표식. work tree 밖이라 dirty 가 아니다
git -C "$DEST" remote add origin https://github.com/Felix-LeeSM/table-view.git
git -C "$DEST" fetch origin "$OID" '+refs/heads/main:refs/remotes/origin/main'
git -C "$DEST" -c advice.detachedHead=false checkout --detach "$OID"
test "$(git -C "$DEST" rev-parse HEAD)" = "$OID" || { echo "ABORT: PR head 가 아니다" >&2; exit 1; }
echo "$DEST"   # 회수 블록에 손으로 옮길 값 — 변수는 Bash 호출을 못 넘는다
# 의존성이 필요하면 「생성」 3) 과 같다 — 설치 티어라 subreviewer 는 안 돈다
# 회수 — 검증이 사이에 끼므로 생성과 다른 Bash 호출이고 거기엔 $DEST 가 없다
TARGET="<위 echo 가 찍은 경로 — mktemp 꼬리까지 그대로>"
test -n "$TARGET" && test "$(cat "$TARGET/.git/.review-clone" 2>/dev/null)" = "$TARGET" \
  || { echo "ABORT: 이 레시피가 만든 사본이 아니다" >&2; exit 1; }
rm -rf "$TARGET"
```

- **이 절차는 `PRIMARY` 를 쓰지 않고, 현재 작업 디렉토리를 아예 읽지 않는다.**
  리뷰어의 첫 명령은 저자 사본 **밖**에 서 있을 것을 요구할 뿐 그 바깥이라면
  어디든 허용하기 때문에(`.agents/prompts/pr-review.md` 「MANDATORY 첫 명령」),
  `git rev-parse --show-toplevel` 이 무엇을 낼지는 정해져 있지 않다. 위 형태는
  `dirname "$AUTHOR"` 만 읽으므로, 리뷰어가 어디에 서 있든 언제나 같은 부모
  디렉토리 아래에 사본을 만든다.
- **저자 사본을 clone 의 소스로 쓰지 않는다.** 저자 사본은 계속 변하고 있고, 아직
  push 하지 않은 커밋을 갖고 있다. 2026-08-07 에 관측한 사례는 이렇다. PR #2210
  의 저자 사본이 그 시점의 head 인 `2e0bd76fc606` 위에 아직 push 하지 않은 커밋
  `e6a2817bd5b6` 을 갖고 있었고, 그 사본에서 `gh pr checkout 2210` 이 "Already up
  to date" 를 내는 바람에 GitHub 에 없는 커밋이 근거가 될 뻔했다. 그 커밋은 몇 분
  뒤에 push 되어 head 가 되었으므로, 이 대조를 지금 다시 재현할 수는 없다. 그래서
  clone 의 소스는 GitHub 로 잡고 체크아웃 대상은 OID 로 잡으며, 마지막 `test` 를
  통과하기 전에는 어떤 출력도 근거로 쓰지 않는다.
- 디렉토리 이름의 앞부분인 `review__<PR>__<OID 앞 12>` 는 브랜치 이름을 쓰는 저자
  사본과 겹치지 않고, 아래 「회수」 절차와 종결자의 스윕이 그 이름에서 PR 번호를
  읽는다. **뒤에 붙는 꼬리는 `mktemp -d` 가 만든다.** 이름을 미리 계산하지 않고
  만들어서 받기 때문에, 같은 PR 의 같은 head 를 보는 노드가 둘이어도 서로 같은
  디렉토리를 쓰지 않는다.
- **`refs/remotes/origin/main` 을 함께 가져온다.** 가져오지 않으면 이 저장소가 PR
  body 의 수치에 처방하는 `"$(git merge-base origin/main HEAD)"` 가 사본에서
  rc=128 로 실패한다([delivery](../../workflow/delivery/memory.md) 「PR body」).
- **역사의 깊이를 줄이지 않는다.** 그 이유는 위 「생성」이 얕은 사본을 금지하는
  이유와 같다.

### 결과를 인용하는 법

명령의 출력 자체에는 **그 출력이 어느 커밋에서 나왔는지가 적혀 있지 않다.**
그래서 scorecard 로 옮길 때에는 명령과 head OID 를 함께 적는다. 위에 적은 해악을
막는 장치는 이것뿐이다.

```
`pnpm exec vitest run` @ #2221 head ff7861aedeab → 실패 0
```

OID 가 리뷰하고 있는 라운드의 head 와 다르면, 그 출력은 폐기하고 사본을 다시
만든다.

## 점유: 같은 브랜치에 사본을 둘 만들지 않는다

worktree 가 그냥 제공하던 "같은 브랜치를 두 번 체크아웃하지 못하게 막는 기능" 이
clone 에는 없다. 그래서 점유 상태를 GitHub 에 기록해 둔다.

- 노드를 spawn 할 때 orchestrator 가 해당 이슈에 `착수: <branch>` 코멘트를
  남긴다. 사본 경로는 `../table-view-clones/<branch-sanitized>` 라는 규약에서
  파생되므로, 로컬 경로를 GitHub 에 적지 않는다.
- spawn 하기 전에 두 가지를 확인한다. 이슈에 아직 유효한 점유 코멘트가 없는지를
  보고, `git ls-remote origin <branch>` 가 stale ref 를 내지 않는지를 본다. stale
  ref 가 있으면
  [recovering-push-rejects](../../../.agents/skills/recovering-push-rejects/SKILL.md)
  의 「재 spawn 시 stale ref 검증」을 따른다.
- **stalled 나 timeout 알림이 왔다고 해서 노드가 죽었다고 확정할 수는 없다.**
  확인하지 않고 다시 spawn 하면 같은 사본에 노드가 둘 붙으므로, 점유 코멘트와
  실제로 살아 있는 프로세스를 먼저 확인한다.

## 첫 turn 검증 (MANDATORY)

```bash
# 그 사본에서 일하는 역할(issue-implement)은 `=`, 남의 사본에 서면 안 되는
# 역할(pr-review · pr-subreview · pr-finalize)은 `!=` 로 뒤집어 쓴다
test "$(git rev-parse --show-toplevel)" = "<사본 경로>" \
  || { echo "ABORT: wrong checkout" >&2; exit 1; }
```

spawn 하는 쪽이 역할에 맞는 형태를 프롬프트의 첫 명령 자리에 넣는다. 비교
연산자를 잘못 복사하면 가드가 반대로 걸린다. 판정에 실패하면 즉시 중단하고
보고해야 하며, 다른 디렉토리에서 작업을 재개하지 않는다. cross-checkout 오염은
sprint-380 과 sprint-381, sprint-385 에서 관측된 실제 사고다.

## 회수

- **판정 대상은 사본 루트 전체이고**, spawn 이 알려 준 경로 하나가 아니다. 그중
  `review__<PR>__<OID>__<꼬리>` 형태는 tip 이 아니라 **이름에 적힌 PR 번호**로
  판정한다. 그 사본은 detached 상태이고 tip 이 지난 라운드의 head 이기 때문에,
  아래 대조를 그대로 적용하면 언제까지나 보존해야 한다는 결과가 나온다. 그 PR 이
  닫혔는지를 읽어야 지울 수 있다.
- 머지된 PR 의 head OID 를 받아서 **사본의 tip 이 그 안에 포함될 때에만** 지운다.
  조상 관계로 판정해서는 안 된다. squash 머지에서는 그 판정이 양쪽 방향으로 모두
  틀린다. #1932 에서 실제로 재 보니 머지된 사본 5개를 하나도 검출하지 못했고,
  활성 사본 2개를 지워도 되는 것으로 잘못 검출했다. 판정할 수 없는 사본은
  머지되지 않은 것으로 취급한다.
- **dirty 한 사본은 지우지 않는다.** untracked 파일만 있는 상태도 dirty 로 본다.
  머지된 PR 의 사본에서 커밋하지 않은 51줄이 나온 사례가 있다. 이때에는 보존하는
  사유를 기록하고 넘어간다.
- 절대로 지우지 않는 대상이 있다. primary 를 지우지 않고, 지금 명령을 실행하고
  있는 그 사본도 지우지 않으며, `git status` 를 읽을 수 없는 사본도 지우지
  않는다. 명령을 실행하고 있는 사본을 지우면 getcwd 오류가 발생해서 스윕이 조용히
  중간에 끊긴다.
- `gh pr merge --delete-branch` 는 브랜치만 지운다. 디스크를 회수하는 일은
  별개이고, 종결자인 pr-finalize 가 맡는다.

## 책임

- 사본을 만들고 회수하는 일은 orchestrator 가 spawn 할 때 명시적으로 실행한다.
  agent 가 스스로 판단해서 만들지 않는다. 사용자가 볼 수 없는 디스크를 점유하기
  때문이다. 막아 주는 장치는 없고 규율만 있다.
- **이 규칙의 예외는 리뷰어가 쓰는 일회용 검증 사본뿐이고**, 그 사본은 리뷰어가
  스스로 만든다([review](../../workflow/review/memory.md) 「행동 계약」). 디스크를
  점유한다는 사유는 그대로 적용되므로 **만든 리뷰어가 같은 턴에 지운다.** 지울
  자격은 위 「리뷰어 사본」이 정하고, 표식에 적힌 경로가 그 트리 자신의 경로가
  아니면 손대지 않는다. 회수하는 셸에는 `$DEST` 변수가 남아 있지 않아서 「자기가
  만든 것만 지운다」를 기계가 보장하지 못하고, `mktemp` 가 붙인 꼬리가 대신
  지킨다. 같은 PR 을 동시에 보는 coordinator 와 subreviewer 가 서로의 트리를
  지우던 자리이기 때문이다(#2286). 리뷰어가 지우지 못한 채로 죽으면 위 「회수」
  절차가 대신 회수한다.
- 작업 사본은 PR 하나마다 하나만 두고, 그 사본을 동시에 쓰는 노드도 하나로
  제한한다. 그 사본에 파일을 쓰는 역할은 구현자뿐이고, 리뷰어는 저자 사본을
  편집하지 않는다. 리뷰 라운드마다 새 사본을 만들지 않고, 같은 사본에 다음
  구현자를 붙인다. 사본을 나누면 죽은 구현자가 push 하지 못한 커밋을 이어받지
  못하기 때문이다.

## Agent hard rule: reset --hard 의 remote/upstream target 형과 pull 을 금지한다

`git reset --hard FETCH_HEAD/ORIG_HEAD/origin/*/@{u}` 와 `git pull` 의 모든 변종은
**절대로 쓰지 않는다.** 훅이 막아 주지 않는다. **다만 `git fetch` 자체는 금지
대상이 아니다.** 위에 적은 `FETCH_HEAD` 는 `reset --hard` 가 받는 대상이지
`fetch` 명령이 아니고, 이 파일의 「리뷰어 사본」이 `git fetch` 를 절차로
처방하고 있다.

push reject 를 회복하는 일은 명령 시퀀스이기 때문에 skill 이 SOT 를 갖는다.
[recovering-push-rejects](../../../.agents/skills/recovering-push-rejects/SKILL.md)
가 「회복 정답 (4-step)」과 외부 race 가짜 신호, SHA refspec push 를 소유한다.
계약 쪽은 [git-policy](../../workflow/git-policy/memory.md) 가 소유한다.

## 관련

- [delivery](../../workflow/delivery/memory.md): 노드 표와 머지 정책을 갖는다.
- [git-policy](../../workflow/git-policy/memory.md): hook 회피 금지와 push 규율을
  갖는다.
- [orchestration](../../workflow/orchestration/memory.md): spawn 결정과 점유
  기록을 갖는다.
