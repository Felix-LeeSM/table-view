---
title: Multi-agent worktree
type: runbook
updated: 2026-07-30
task: worktree, multi-agent, parallel, spawn-verify, agent-hard-rule
---

# Multi-agent worktree

다중 brain (Claude Code / Codex / Cursor) 또는 다중 agent 가 동일 repo 에서
병렬 작업할 때 worktree 로 인스턴스 격리. 각 worktree 는 독립 디렉토리 +
독립 branch → 충돌 없이 동시 실행.

**worktree 도구와 가드는 없다.** 아래 절차는 전부 수동이고, 어겨도 막아 주는
것이 없다.

## 소유권 / SOT

- 본 파일이 worktree 사용 시점, 격리 의미, lifecycle guardrail 을 소유한다.
  위임할 script `--help` 가 더는 없으므로 여기가 유일한 SOT 다.
- commit / push / PR / merge 행동 계약은 [delivery](../../workflow/delivery/memory.md)
  가 소유한다. push reject 회복 정책은
  [git-policy](../../workflow/git-policy/memory.md) 가 소유한다.

## 사용 시점

- 여러 작업을 병렬 진행 (작업 1개 = worktree 1개)
- 사용자가 같은 repo 에서 다른 brain (예: Codex review + Claude implement)
  을 동시에 돌리고 싶을 때
- read-only 리뷰는 worktree 없이 main 에서 해도 충돌하지 않는다

## 명령

```bash
# 새 worktree + branch — 디렉토리 이름은 브랜치의 `/` 를 `__` 로 바꾼 형태
git worktree add -b sprint-388/foo worktrees/sprint-388__foo origin/main

# 의존성
cd worktrees/sprint-388__foo && pnpm install --frozen-lockfile --prefer-offline
cargo fetch --manifest-path src-tauri/Cargo.toml

# 정리 — dirty 여부를 반드시 먼저 본다
git -C worktrees/sprint-388__foo status --short
git worktree remove worktrees/sprint-388__foo
git worktree prune                    # stale 메타데이터만
```

`src-tauri/target/` 은 복사하지 않는다. 복사본은 stale path 로 tauri 빌드를
깨뜨린 전력이 있다 — 새 worktree 는 cold 로 시작한다.

## 격리 동작

- worktree 디렉토리: `worktrees/<branch-sanitized>/` (repo 안, gitignored)
  - 예: `sprint-388/foo` → `worktrees/sprint-388__foo/`
  - `worktrees/` 는 platform-neutral — 어떤 brain 이든 같은 경로.
  - `.claude/worktrees/` 와 별개 — 그쪽은 Claude Code 의 sub-agent 전용.
- git hook 은 없다 — worktree 별로 설치할 것도 없다.
- working tree state (untracked / staged) 는 worktree 별 독립

## 책임

- spawn: orchestrator (현재 메인 세션) 가 명시 호출. agent 가 자율로
  worktree 생성하지 않음 (사용자가 보지 못하는 디스크 공간 차지 위험). 이걸
  막는 장치는 없고 규율만 있다.
- cleanup: PR 머지 직후 또는 작업 종료 시. `gh pr merge --delete-branch`
  는 branch 만 삭제 — worktree 디스크는 별도 정리 필요.
- **dirty worktree 는 지우지 않는다** (untracked 도 dirty). 2026-07-29 실측에서
  머지된 PR 의 worktree 하나가 커밋 안 된 51줄을 갖고 있었다 — 먼저 확인하고
  보존 사유를 기록한다. 자동 SKIP 해 주던 스크립트가 없으니 손으로 본다.

## 머지 판정 — 조상 관계를 쓰지 마라

**조상 관계는 머지 여부와 무관하다** — 양쪽으로 틀린다 (#1932, 2026-07-29 실측).
squash 머지된 브랜치는 main 의 조상이 아니라 머지된 worktree 5개를 하나도 못
잡았고, 방금 spawn 한 브랜치는 `origin/main` 에 앉아 자명한 조상이라
`for-each-ref --merged` 가 나열한 32건 중 둘이 머지 PR 0건인 활성 worktree 였다.

머지된 PR 의 head OID 를 받아 **로컬 tip 이 그 안에 포함될 때만** 지운다. 이름은
한 번 참이면 영원히 참이라 이름 재사용과 머지 뒤 추가 커밋을 못 거른다. 판정 불가는
미머지로 취급한다 — 조용한 0건이 그 버그의 서명이었다.

절대 안 지우는 것: main worktree, **명령을 실행한 그 worktree** (지우면 이후 git
호출이 getcwd 에러를 뱉고 스윕이 조용히 잘린다), `git status` 를 못 읽는
worktree, `git worktree list` 에 없는 디렉토리 (남의 저장소일 수 있다).
gitignore 된 로컬 상태는 디렉토리와 함께 사라진다.

## Primary worktree guard

primary worktree 는 orchestration-only. `memory/` 와 `AGENTS.md` 같은 agent
계약 수정, `worktrees/*` linked target 생성/수정만 허용한다. `docs/`, app
source/config/manifest 는 linked worktree 에서 수정한다.

집행하던 훅(`check-main-worktree-source-edit.sh`)이 삭제돼 지금은 **차단되지 않는다.**
primary 에서 소스를 고치고 있다는 걸 스스로 알아채야 한다.

## Agent lifecycle

orchestrator 는 spawn 할 때 agent registry 를 머릿속/작업 노트에 유지:

| state | 의미 |
|---|---|
| planned | 목적 / PR / worktree / node / 종료 조건 확정 |
| running | agent 작업 중. 같은 책임 중복 spawn 금지 |
| waiting | CI / review / 사용자 결정 대기 |
| done | 결과가 PR 또는 branch 에 반영됨 |
| closed | close + worktree cleanup 또는 보존 사유 기록 완료 |
| abandoned | 실패/오염. push 금지, close 후 상태 기록 |

**worktree 는 PR 당 하나이고, 거기에 동시에 쓰는 node 는 하나다.** 파일을 쓰는
역할은 구현자뿐이고 reviewer 는 read-only. review finding 은 새 worktree 를 만들지
말고 같은 worktree 에 다음 라운드 구현자를 붙인다 — node 당 worktree 로 쪼개면 죽은
구현자의 미푸시 커밋을 다음 구현자가 이어받지 못한다.

## 주의

- worktree 안에서 또 worktree spawn 하지 마. 동일 base repo 의 `.git/worktrees/`
  메타데이터가 중첩 시 추적 어려움.
- `git push --force` 같은 destructive 명령은 금지다. 차단하는 장치가 없으니
  실행되기 전에 스스로 멈춰야 한다.

## 첫 turn 검증

다중 worktree 병렬 작업 시 *cross-worktree contamination* (다른 worktree 의
디렉토리에서 작업) 위험이 있음. sprint-381 / 380 / 385 에서 3 회 관측됨.
agent 가 첫 turn 에 반드시 worktree path 검증:

```bash
# expected_path = orchestrator 가 spawn 시 알려준 worktree path
test "$(git rev-parse --show-toplevel)" = "<expected_path>" \
  || { echo "ABORT: wrong worktree" >&2; exit 1; }
```

이 스니펫을 자동 출력해 주던 spawn 스크립트가 없으므로 orchestrator 가 직접
agent prompt 의 "MANDATORY first command" 슬롯에 넣는다. 불일치 시 agent 는
**즉시 abort + 사용자 보고**. main 디렉토리에서 작업 재개 X.

### Agent hard rule — fetch/reset/pull 금지

`git fetch && git reset --hard FETCH_HEAD`, `git reset --hard
FETCH_HEAD/ORIG_HEAD/origin/*/@{u}/refs/remotes/*`, `git pull` (모든 변종)
**절대 금지**. 이것도 훅이 막아 주지 않는다.

Push reject 시 회복 정답:

```bash
git ls-remote origin <branch>                           # 1) remote SHA 진단
git reflog                                              # 2) 직전 본인 SHA
git update-ref refs/heads/<branch> <local-sha>          # 3) ref 만 fix
SHA="$(git rev-parse HEAD)"
git push origin "$SHA":refs/heads/<branch>              # 4) SHA refspec push
```

자세히: [git-policy](../../workflow/git-policy/memory.md) — 외부 race 가짜
신호 + Push reject 응급 처치 절.

## 관련

- [delivery](../../workflow/delivery/memory.md) — branch 머지 정책
- [git-policy](../../workflow/git-policy/memory.md) — hook 회피 금지
