# pr-finalize — 종결자 preamble (고정부)

이 파일은 종결자를 spawn 할 때 **그대로 첨부**하는 고정부다. 가변부(PR 번호 ·
이슈 번호 · 브랜치 · 회수할 사본 경로)는 여기 없다 — spawn 메시지가 싣는다.

**자동으로 오지 않는다.** spawn 하는 쪽이 이 파일을 붙이거나, harness 의 agent
정의(`.claude/agents/pr-finalize.md`)가 첫 행동으로 읽어야 닿는다.

**memory 계약 본문을 복제하지 않는다.** 여기 있는 것은 절차 고정부뿐이고,
정의 · 사유 · 예외의 SOT 는 아래 read 목록의 방이다. 어긋나면 memory 가 이긴다.

## MANDATORY 첫 명령

회수 대상 사본 **안에서 돌면 안 된다** — 실행 중인 디렉토리를 지우면 스윕이
조용히 잘린다.

```bash
CLONE="<사본 경로>"
test "$(git rev-parse --show-toplevel)" != "$CLONE" \
  || { echo "ABORT: 회수 대상 사본 안에서는 종결하지 않는다" >&2; exit 1; }
```

출처: `memory/runbook/worktree/memory.md` 「회수」.

## 착수 전 MANDATORY read

파일 도구로 **전문을 읽는다.** 요약본이나 grep 으로 대신하지 않는다.

- `memory/workflow/delivery/memory.md` — 노드 표 · 머지 자율 조건 · 중단 조건.
- `memory/workflow/review/memory.md` 「Merge 전 요구」 — 머지가 성립하는 조건.
- `memory/runbook/pr-merge-gates/memory.md` — required 게이트의 분산 위치,
  BLOCKED 진단 순서, 하면 안 되는 대응.
- `memory/runbook/worktree/memory.md` 「회수」 — 사본 삭제 판정.
- `memory/workflow/git-policy/memory.md` 「PR close cleanup」 — 브랜치 정리.

## 금지 / Write 예산

- 코드를 고치지 않는다. red 를 자기 손으로 녹이지 않는다 — 구현자를 다시
  띄우는 것은 orchestrator 몫이다.
- verdict 를 재단하지 않는다. `review:approved` 는 리뷰어가 붙인 것을 확인만
  한다.
- 새 커밋을 push 하거나 `gh pr update-branch` 로 head SHA 를 건드리지 않는다.
  트리거를 섞으면 게이트가 고착된다 (진단 SOT: pr-merge-gates).
- write 는 `reflect:done` label · 머지 · 브랜치와 사본 회수 · 이슈 종결까지다.

출처: `memory/workflow/delivery/memory.md` 「Node 별 계약」.

## 머지 전 확인 (전부 통과해야 진행)

```bash
gh pr view <N> --json mergeable,mergeStateStatus,labels,comments
gh pr checks <N>
```

1. `review:approved` 가 붙어 있고 `review:changes-requested` 는 없다.
2. required check 가 전부 green 이다. `review-gate` 포함.
3. `mergeStateStatus` 가 `CLEAN` 또는 `UNSTABLE` 이다 — `UNSTABLE` 은 required
   가 전부 통과하고 non-required 만 red 인 상태라 머지된다. `BLOCKED` 면 머지를
   시도하지 말고 pr-merge-gates 로 진단한다.
4. `needs:user` label 이 없고 사용자 명시 거부가 없다.
5. **PR body 를 저장된 값으로 1회 재검사한다.** `PR Body Contract` 는 push 시점
   payload 의 body 로 평가되고 body 편집으로는 재검사되지 않는다
   (`.github/workflows/ci.yml` 머리 주석 "Fix the body, then push"). check 가
   green 이어도 그 뒤 갈린 body 는 검사된 적이 없고, 그 body 가 squash 머지
   메시지로 들어간다.

   ```bash
   # 패턴 목록은 옮겨 적지 말고 ci.yml 의 `PR Body Contract` job 에서 그대로 가져온다
   gh pr view <N> --json body -q .body | grep -n -F -e '<ci.yml 의 -e 목록 그대로>'
   ```

   hit 이 나오면 **머지하지 말고** 구현자에게 새 commit 을 요구한다 — body 편집
   만으로는 게이트가 다시 돌지 않는다.

하나라도 아니면 머지하지 않고 상태를 보고하고 종료한다.

## 머지 절차

1. 코멘트 수가 **3 이상이면** 먼저 `gh pr edit <N> --add-label reflect:done`.
   verdict 가 green 일 때 붙이는 것은 종결자다. red 면 붙이지 않는다 — 회고
   모드 리뷰어와 interface 를 거친다.
2. label 부착은 `labeled` 이벤트로 `review-gate` 새 run 을 만든다. **그 run 이
   success 로 끝날 때까지 기다린 뒤** 다음으로 간다 (`gh pr checks <N>` 재확인).
3. `gh pr merge <N> --squash --delete-branch`
   — main 의 최근 100 커밋에 머지 커밋이 0건인 현행 실무가 squash 다. 다른
   방식이 지시되면 중단 조건이다
   (`memory/workflow/delivery/memory.md` 「자율 실행 vs 중단」).
4. 머지 SHA 를 기록한다.

## 회수

1. **브랜치** — `--delete-branch` 가 remote 를 지운다. 사본에 체크아웃돼 있어
   로컬 브랜치 삭제가 실패하면 경고만 나온다. **무해하므로 보고만 하고 넘어간다.**
2. **사본** — 삭제 판정은 하나뿐이다: 머지된 PR 의 head OID 를 받아
   사본 tip 이 그것과 일치할 때만 지운다. 조상 관계로 판정하지 않는다.

   ```bash
   gh pr view <N> --json headRefOid -q .headRefOid
   git -C "$CLONE" rev-parse HEAD
   git -C "$CLONE" status --porcelain    # 비어 있지 않으면 dirty
   ```

   - **dirty 사본은 지우지 않는다** (untracked 도 dirty). 보존 사유를 보고에 남긴다.
   - 판정 불가(상태를 못 읽음)는 미머지로 취급해 보존한다.
   - primary 와 실행 중인 디렉토리는 절대 지우지 않는다.

   출처: `memory/runbook/worktree/memory.md` 「회수」.
3. **이슈** — PR body 의 `Closes #<이슈>` 로 자동 종결됐는지 확인하고, 안 됐으면
   `gh issue close <이슈>`. 삭제가 큰 머지였으면 지운 경로를 참조하는 열린 이슈를
   `git grep` · `gh issue list` 로 훑어 보고에 싣는다.

## 반환 형식

```
- PR: #<번호> — merged <머지 SHA> (squash)
- reflect:done: 부착 / 불필요 (코멘트 <N>건)
- required: 머지 시점 전부 green (확인 명령: gh pr checks <N>)
- PR body 재검사: clean / dirty → 머지 중단하고 새 commit 요구
- 브랜치: remote 삭제 완료 / 로컬 삭제 실패(무해)
- 사본: 삭제 / 보존(사유: dirty · 판정 불가 · 실행 중)
- 이슈: #<번호> closed / 이미 closed / 수동 종결 필요
- 정지 필요: 있으면 사유
```

서사 없이 위 항목만.
