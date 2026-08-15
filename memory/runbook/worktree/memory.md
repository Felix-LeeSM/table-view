---
title: 작업 사본 격리 — clone
type: runbook
updated: 2026-08-11
task: clone, worktree, multi-agent, parallel, spawn-verify, agent-hard-rule
keywords: index.lock, FETCH_HEAD, git fetch, git clone --local, 사본, 격리, cross-worktree, getcwd, 회수, dirty, 브랜치 점유, non-fast-forward, push reject, stalled, timeout, respawn, npx, pnpm exec, cargo clean, stale path, 일회용 사본, 리뷰어 사본, PR head, headRefOid, gh pr checkout, checkout --detach, review__, --depth, shallow clone, is-shallow-repository, --unshallow, bad object
---

# 작업 사본 격리 — clone

다중 agent 가 같은 repo 에서 병렬 작업할 때 **독립 clone** 으로 격리한다.
작업 1개(=PR 1개) = 사본 1개.

2026-07-31 사용자 결정(#2035 결정 7): `git worktree add` 대신 clone. linked
worktree 는 `.git` 을 공유해 index.lock 겹침·FETCH_HEAD 등 공유 자원 충돌이
실측됐고, 공유 config(hooksPath)를 한 작업이 바꾸면 병렬 전체가 무장해제되는
사고 유형(#1860)도 있었다. clone 은 `.git` 이 완전 독립이라 이 유형이 통째로
소멸한다. 기존 `worktrees/` 는 신규 생성 금지 — 남은 것은 회수 절차만 따른다.

**도구와 가드는 없다.** 아래 절차는 전부 수동이고, 어겨도 막아 주는 것이 없다.

## 소유권 / SOT

- 본 파일이 사본 격리(생성·점유·회수)의 유일한 SOT 다 — 예외는 아래가 지명하는
  소유자뿐이다.
- commit / push / PR / merge 행동 계약은 [delivery](../../workflow/delivery/memory.md),
  push reject 의 계약은 [git-policy](../../workflow/git-policy/memory.md),
  회복 절차는 [recovering-push-rejects](../../../.agents/skills/recovering-push-rejects/SKILL.md) 소유.
- 리뷰어의 **일회용 사본**도 본 파일 소유다 — 만드는 법은 아래 「리뷰어 사본」,
  지우는 의무는 아래 「책임」. [review](../../workflow/review/memory.md) 「행동 계약」은
  언제 · 어느 노드가 만드는지를 정한다. 작업 사본과 별개다.

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

- **사본은 얕으면 안 된다 — 소스는 GitHub 이고 primary 가 아니다.** primary 가
  shallow 라(경계 `539d05f3`, 2026-06-11) `git clone --local` 은 `--local` 을
  무시하고 거기까지만 복제한다. 2026-08-10 실측:
  `git rev-list --count 0da61f06` 이 그렇게 뜬 사본에선 778, GitHub clone 에선
  1921 이다. 잘려도 에러가 안 나고 정상적인 숫자가 나오니 위 `test` 로 판정한다.
  `--depth` 도 같은 금지다 — `--depth 1` 이면 `scripts/sweep/core-split-prose.mjs` 의
  고정 커밋이 없어 `pnpm test` 가 죽는다 (CI 도 `frontend-shard` 잡에 `fetch-depth: 0`).
- 위치: primary **밖** 형제 디렉토리 `../table-view-clones/`. repo 안에 두면
  rg·Tailwind source scan·lint 글롭이 사본을 훑는 함정이 생기고 `.gitignore`
  로는 도구 전부를 못 막는다.
- `src-tauri/target/`·`node_modules/` 복사 금지 — 복사본 stale path 가 tauri
  빌드를 깨뜨린 전력. 사본은 cold 로 시작한다. 이미 warm-copy 잔재로 tauri 검사가
  stale path 를 물면 `cargo clean` 이 근본 fix 다.
- hook 설정(core.hooksPath 등)도 사본별 독립 — 한 사본의 변경이 남을 못 건드린다.
- 사본 안에서 도구는 **버전을 고정해** 실행한다 — `pnpm exec <도구>` 또는
  `npx <pkg>@<버전>`. bare `npx biome` 가 동명의 무관 패키지를 끌어와 false green
  을 낸 실측이 있다 (2026-07-31).

## 리뷰어 사본 — PR head 를 체크아웃한다

위 「생성」은 구현자용이라 `origin/main` 을 잡는다. 리뷰어가 그대로 쓰면 **PR 의 변경이
하나도 안 들어간 트리**에서 test·lint·build 를 돌리고 그 출력을 scorecard 근거로 인용하게
된다 — 통과든 실패든 무의미한데 출력 어디에도 그 사실이 안 드러난다. 만들 조건은
[review](../../workflow/review/memory.md) 「행동 계약」, 지우는 의무는 아래 「책임」이다.

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
test "$(git -C "$DEST" rev-parse HEAD)" = "$OID" \
  || { echo "ABORT: PR head 가 아니다" >&2; exit 1; }
# 의존성이 필요하면 「생성」 3) 과 같다 — 설치 티어라 subreviewer 는 안 돈다
# 회수 (같은 턴) — 지울 대상은 위 mktemp 가 이 노드에 준 $DEST 뿐이다
TARGET="$DEST"   # $DEST 가 안 잡혔거나 표식이 그것과 다르면 아래가 막는다
test -n "$DEST" && test "$(cat "$TARGET/.git/.review-clone" 2>/dev/null)" = "$DEST" \
  || { echo "ABORT: 이 노드가 만든 사본이 아니다" >&2; exit 1; }
rm -rf "$TARGET"
```

- **`PRIMARY` 를 안 쓴다 — cwd 를 아예 안 읽는다.** 리뷰어의 첫 명령이 저자 사본
  **밖**을 요구하고 그 밖에는 어디든 허용하므로(`.agents/prompts/pr-review.md`
  「MANDATORY 첫 명령」) `git rev-parse --show-toplevel` 이 무엇을 낼지 정해져
  있지 않다. 위 형태는 `dirname "$AUTHOR"` 만 읽어 어디에 서 있든 같은 부모에 만든다.
- **저자 사본을 clone 소스로 쓰지 않는다.** 저자 사본은 살아 움직이고 push 안 된
  커밋을 갖는다. 2026-08-07 실측: PR #2210 의 저자 사본이 그 시점 head
  `2e0bd76fc606` 위에 미push 커밋 `e6a2817bd5b6` 을 얹고 있었고, 거기서
  `gh pr checkout 2210` 이 "Already up to date" 를 내 GitHub 에 없는 커밋이 근거가 될
  뻔했다 (그 커밋은 몇 분 뒤 push 돼 head 가 됐으니 이 대조는 지금 재현되지 않는다).
  그래서 소스는 GitHub, 대상은 OID 이고, 마지막 `test` 전에는 출력을 근거로 안 쓴다.
- 앞부분 `review__<PR>__<OID 앞 12>` 는 저자 사본(브랜치 이름)과 안 겹치고 「회수」와
  종결자 스윕이 거기서 PR 을 읽는다. **꼬리는 `mktemp -d` 가 붙인다 — 이름을 계산하지
  않고 만들어서 받으므로** 같은 PR·같은 head 를 보는 노드 둘이 못 겹친다.
- **`refs/remotes/origin/main` 을 같이 가져온다.** 안 가져오면 이 저장소가 PR body
  수치에 처방하는 `"$(git merge-base origin/main HEAD)"` 가 사본에서 rc=128 로 죽는다
  ([delivery](../../workflow/delivery/memory.md) 「PR body」).
- **깊이를 줄이지 않는다** — 사유는 위 「생성」의 얕은 사본 금지와 같다.

### 결과를 인용하는 법

출력 자체에는 **어느 커밋에서 나왔는지가 안 적혀 있다.** scorecard 로 옮길 때 명령과
head OID 를 같이 적는다 — 위 해악을 막는 장치는 이것뿐이다.

```
`pnpm exec vitest run` @ #2221 head ff7861aedeab → 실패 0
```

OID 가 리뷰 중인 라운드의 head 와 다르면 그 출력은 폐기하고 사본을 다시 만든다.

## 점유 — 같은 브랜치에 사본 둘 금지

worktree 가 공짜로 주던 "같은 브랜치 이중 체크아웃 방지"가 clone 에는 없다.
대신 상태를 GitHub 에 둔다:

- spawn 시 orchestrator 가 해당 이슈에 `착수: <branch>` 코멘트를 남긴다. 사본
  경로는 규약(`../table-view-clones/<branch-sanitized>`)에서 파생되므로 로컬
  경로를 GitHub 에 적지 않는다.
- spawn 전 확인 둘: 이슈에 살아 있는 점유 코멘트가 없는가,
  `git ls-remote origin <branch>` 가 stale ref 를 내지 않는가
  (stale 이면 [recovering-push-rejects](../../../.agents/skills/recovering-push-rejects/SKILL.md)
  의 「재 spawn 시 stale ref 검증」).
- **stalled/timeout 알림은 사망 확정이 아니다.** 확인 없이 respawn 하면 같은
  사본에 노드가 둘 붙는다 — 점유 코멘트와 살아 있는 프로세스를 먼저 확인한다.

## 첫 turn 검증 (MANDATORY)

```bash
# 그 사본에서 일하는 역할(issue-implement)은 `=`, 남의 사본에 서면 안 되는
# 역할(pr-review · pr-subreview · pr-finalize)은 `!=` 로 뒤집어 쓴다
test "$(git rev-parse --show-toplevel)" = "<사본 경로>" \
  || { echo "ABORT: wrong checkout" >&2; exit 1; }
```

spawner 가 역할에 맞는 쪽을 prompt 의 첫 명령 슬롯에 넣는다 — 부호를 잘못
복사하면 가드가 반대로 선다. 판정 실패 = 즉시 abort + 보고, 다른 디렉토리에서
작업 재개 금지. cross-checkout 오염은 3회 관측된 실사고다 (sprint-380/381/385).

## 회수

- **판정 대상은 사본 루트 전체다** (spawn 이 준 경로 하나가 아니다). 그중
  `review__<PR>__<OID>__<꼬리>` 는 tip 이 아니라 **이름에 박힌 PR** 로 판정한다 — detached 고
  tip 이 옛 라운드 head 라 아래 대조가 영구 보존을 낸다. 닫힘을 읽어야 지운다.
- 머지된 PR 의 head OID 를 받아 **사본 tip 이 그 안에 포함될 때만** 지운다.
  조상 관계 판정 금지 — squash 머지에서 양쪽으로 틀린다 (#1932 실측: 머지된
  5개 0건 검출 + 활성 2개 오검출). 판정 불가는 미머지로 취급한다.
- **dirty 사본은 지우지 않는다** (untracked 도 dirty). 머지된 PR 사본에서
  미커밋 51줄이 나온 실측이 있다. 보존 사유를 기록하고 넘어간다.
- 절대 안 지우는 것: primary, 명령을 실행 중인 그 사본(지우면 getcwd 에러로
  스윕이 조용히 잘린다), `git status` 를 못 읽는 사본.
- `gh pr merge --delete-branch` 는 branch 만 지운다 — 디스크 회수는 별도이고
  종결자(pr-finalize) 소관.

## 책임

- 생성/회수: orchestrator 가 spawn 시 명시 실행. agent 가 자율 생성하지 않는다
  (사용자가 못 보는 디스크 점유). 막는 장치 없음 — 규율만.
- **예외는 리뷰어의 일회용 검증 사본뿐이다** — 리뷰어가 스스로 만든다
  ([review](../../workflow/review/memory.md) 「행동 계약」). 디스크 점유 사유는 그대로
  걸리므로 **만든 리뷰어가 같은 턴에 지운다 — 자기가 만든 것만이다.** 만드는 법도
  지울 자격도 위 「리뷰어 사본」이 정한다: `$DEST` 가 안 잡혔거나 표식이 그것과 다르면
  손대지 않는다. 같은 PR 을 동시에 보는 coordinator 와 subreviewer 가 서로의 트리를
  지우던 자리가 이것이다 (#2286). 리뷰어가 죽어 안 지우면 「회수」가 줍는다.
- 작업 사본은 PR 당 하나, 동시에 쓰는 node 는 하나 (그 사본에 파일을 쓰는 것은
  구현자뿐 — 리뷰어는 저자 사본을 편집하지 않는다). 리뷰 라운드는 새 사본을
  만들지 않고 같은 사본에 다음 구현자를 붙인다 — 쪼개면 죽은 구현자의 미푸시
  커밋을 못 이어받는다.

## Agent hard rule — reset --hard (remote/upstream target) · pull 금지

`git reset --hard FETCH_HEAD/ORIG_HEAD/origin/*/@{u}`, `git pull` (모든 변종)
**절대 금지**. 훅이 막아 주지 않는다. **`git fetch` 는 금지가 아니다** — 위
`FETCH_HEAD` 는 `reset --hard` 의 대상이지 `fetch` 명령이 아니고, 이 방의
「리뷰어 사본」이 `git fetch` 를 절차로 처방한다.

push reject 회복은 명령 시퀀스라 skill 이 SOT 다 —
[recovering-push-rejects](../../../.agents/skills/recovering-push-rejects/SKILL.md)
「회복 정답 (4-step)」 · 외부 race 가짜 신호 · SHA refspec push. 계약은
[git-policy](../../workflow/git-policy/memory.md).

## 관련

- [delivery](../../workflow/delivery/memory.md) — 노드 표·머지 정책
- [git-policy](../../workflow/git-policy/memory.md) — hook 회피 금지·push 규율
- [orchestration](../../workflow/orchestration/memory.md) — spawn 결정·점유 기록
