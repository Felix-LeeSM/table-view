---
title: 작업 사본 격리 — clone
type: runbook
updated: 2026-08-01
task: clone, worktree, multi-agent, parallel, spawn-verify, agent-hard-rule
keywords: index.lock, FETCH_HEAD, git clone --local, 사본, 격리, cross-worktree, getcwd, 회수, dirty, 브랜치 점유, non-fast-forward, push reject, stalled, timeout, respawn, npx, pnpm exec, cargo clean, stale path
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

- 본 파일이 사본 격리(생성·점유·회수)의 유일한 SOT 다.
- commit / push / PR / merge 행동 계약은 [delivery](../../workflow/delivery/memory.md),
  push reject 회복은 [git-policy](../../workflow/git-policy/memory.md) 소유.

## 생성

```bash
# primary 루트에서 실행 — 사본은 primary "밖" 형제 디렉토리에 만든다
PRIMARY="$(git rev-parse --show-toplevel)"
DEST="$PRIMARY/../table-view-clones/<branch 의 / 를 __ 로>"
# 1) 로컬 객체를 hardlink 로 공유하는 clone — 수 초, 디스크 저렴
git clone --local "$PRIMARY" "$DEST"
DEST="$(cd "$DEST" && pwd -P)"   # `..` 정규화 — 첫 turn 검증(rev-parse)의 문자열 비교와 일치시킨다
# 2) origin 을 GitHub 으로 — 이후 fetch/push 는 GitHub 과 직접 (https — 이
#    머신의 ssh 는 GitHub 인증이 없어 fetch 가 실패한다, 2026-07-31 실측)
git -C "$DEST" remote set-url origin https://github.com/Felix-LeeSM/table-view.git
git -C "$DEST" fetch origin main
git -C "$DEST" checkout -b <branch> origin/main
# 3) 의존성 — cold 시작
cd "$DEST" && pnpm install --frozen-lockfile --prefer-offline
```

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

## 점유 — 같은 브랜치에 사본 둘 금지

worktree 가 공짜로 주던 "같은 브랜치 이중 체크아웃 방지"가 clone 에는 없다.
대신 상태를 GitHub 에 둔다:

- spawn 시 orchestrator 가 해당 이슈에 `착수: <branch>` 코멘트를 남긴다. 사본
  경로는 규약(`../table-view-clones/<branch-sanitized>`)에서 파생되므로 로컬
  경로를 GitHub 에 적지 않는다.
- spawn 전 확인 둘: 이슈에 살아 있는 점유 코멘트가 없는가,
  `git ls-remote origin <branch>` 가 stale ref 를 내지 않는가
  (stale 이면 [git-policy](../../workflow/git-policy/memory.md) 의 재spawn 절차).
- **stalled/timeout 알림은 사망 확정이 아니다.** 확인 없이 respawn 하면 같은
  사본에 노드가 둘 붙는다 — 점유 코멘트와 살아 있는 프로세스를 먼저 확인한다.

## 첫 turn 검증 (MANDATORY)

```bash
test "$(git rev-parse --show-toplevel)" = "<expected_path>" \
  || { echo "ABORT: wrong checkout" >&2; exit 1; }
```

spawner 가 이 스니펫을 prompt 의 첫 명령 슬롯에 넣는다. 불일치 = 즉시 abort +
보고, 다른 디렉토리에서 작업 재개 금지. cross-checkout 오염은 3회 관측된
실사고다 (sprint-380/381/385).

## 회수

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
- 사본은 PR 당 하나, 동시에 쓰는 node 는 하나 (파일 writer 는 구현자뿐,
  리뷰어는 read-only). 리뷰 라운드는 새 사본을 만들지 않고 같은 사본에 다음
  구현자를 붙인다 — 쪼개면 죽은 구현자의 미푸시 커밋을 못 이어받는다.

## Agent hard rule — fetch/reset/pull 금지

`git reset --hard FETCH_HEAD/ORIG_HEAD/origin/*/@{u}`, `git pull` (모든 변종)
**절대 금지**. 훅이 막아 주지 않는다. push reject 시 회복 정답 4-step:

```bash
git ls-remote origin <branch>                    # 1) remote SHA 진단
git reflog                                       # 2) 직전 본인 SHA
git update-ref refs/heads/<branch> <local-sha>   # 3) ref 만 fix
SHA="$(git rev-parse HEAD)"
git push origin "$SHA":refs/heads/<branch>       # 4) SHA refspec push
```

자세히: [recovering-push-rejects](../../../.agents/skills/recovering-push-rejects/SKILL.md)
— 외부 race 가짜 신호 + push reject 응급 처치. 계약은
[git-policy](../../workflow/git-policy/memory.md).

## 관련

- [delivery](../../workflow/delivery/memory.md) — 노드 표·머지 정책
- [git-policy](../../workflow/git-policy/memory.md) — hook 회피 금지·push 규율
- [orchestration](../../workflow/orchestration/memory.md) — spawn 결정·점유 기록
