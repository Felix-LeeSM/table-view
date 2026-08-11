# pr-finalize — 종결자 preamble (고정부)

이 파일은 종결자를 spawn 할 때 **그대로 첨부**하는 고정부다. 가변부(PR 번호 ·
이슈 번호 · 브랜치 · 회수할 사본 경로)는 여기 없다 — spawn 메시지가 싣는다.

**자동으로 오지 않는다.** spawn 하는 쪽이 이 파일을 붙이거나, harness 의 agent
정의(`.claude/agents/pr-finalize.md`)가 첫 행동으로 읽어야 닿는다.

**memory 계약 본문을 복제하지 않는다.** 여기 있는 것은 절차 고정부뿐이고,
정의 · 사유 · 예외의 SOT 는 아래 read 목록의 방이다. 어긋나면 memory 가 이긴다.

## MANDATORY 첫 명령

회수 대상 사본 **안에서 돌면 안 된다.** 사유는
`memory/runbook/worktree/memory.md` 「회수」.

```bash
CLONE="<사본 경로>"
test "$(git rev-parse --show-toplevel)" != "$CLONE" \
  || { echo "ABORT: 회수 대상 사본 안에서는 종결하지 않는다" >&2; exit 1; }
```

## 착수 전 MANDATORY read

파일 도구로 **전문을 읽는다.** 요약본이나 grep 으로 대신하지 않는다.

- `memory/workflow/delivery/memory.md` — 노드 표 · 머지 자율 조건 · 머지 방식
  기본값 · 중단 조건.
- `memory/workflow/review/memory.md` 「Merge 전 요구」 — 머지가 성립하는 조건.
- `memory/runbook/pr-merge-gates/memory.md` — required 게이트의 분산 위치와
  각 required 가 검사하는 것.
- `.agents/skills/diagnosing-merge-gates/SKILL.md` — 라운드 게이트,
  `mergeStateStatus` 값의 뜻, BLOCKED 진단 순서, 하면 안 되는 대응.
- `memory/runbook/worktree/memory.md` 「회수」 — 사본 삭제 판정.
- `.agents/skills/recovering-push-rejects/SKILL.md` 「PR close cleanup」 —
  브랜치 정리 (계약은 `memory/workflow/git-policy/memory.md`).

## 금지 / Write 예산

- 코드를 고치지 않는다. red 를 자기 손으로 녹이지 않는다 — 구현자를 다시
  띄우는 것은 orchestrator 몫이다.
- verdict 를 재단하지 않는다. `review:approved` 는 리뷰어가 붙인 것을 확인만
  한다.
- 새 커밋을 push 하거나 `gh pr update-branch` 로 head SHA 를 건드리지 않는다.
  트리거를 섞었을 때 무엇이 고착되는지는
  `.agents/skills/diagnosing-merge-gates/SKILL.md` 「잘못된 대응이 만드는 함정」.
- write 는 `reflect:done` label · 머지 · 브랜치와 사본 회수 · 이슈 종결까지다.

출처: `memory/workflow/delivery/memory.md` 「Node 별 계약」.

## 1단계 — 라운드 게이트 (관문보다 **먼저**)

라운드 3 이상인 PR 은 `reflect:done` 이 없으면 `review-gate` 가 red 다. 그래서 이
절이 「머지 전 확인」보다 앞에 있다 — 관문부터 보면 바로 그 red 때문에 부착 지점에
도달하지 못한다.

**라운드는 코멘트 수가 아니라 서로 다른 head 커밋에 붙은 리뷰 인계의 수다**
(#1968). 이 수를 세는 것은 게이트의 `Count review rounds by head OID` 스텝이고,
종결자는 다시 세지 않는다 — 게이트가 낸 판정을 읽는다.

1. verdict 를 먼저 본다. `review:approved` 가 있고 `review:changes-requested`
   가 없어야 한다. red 면 여기서 종료한다 — 종결자는 red 를 진행시키지 않는다.
2. 코멘트 수가 **3 미만이면 라운드도 3 미만이다** (라운드 ≤ 코멘트 수) — 부착 없이
   2단계로 간다. 3 이상이면 최신 `review-gate` run 을 본다: `Stop at review round 3`
   에서 red 면 라운드 3 이상이고, 그 스텝이 `rounds=N` 을 에러로 찍는다.
3. 라운드 3 이상 + green verdict 이면 `gh pr edit <N> --add-label reflect:done`.
   green 일 때 붙이는 것이 종결자다. red 면 붙이지 않는다 — 회고 모드 리뷰어와
   interface 를 거친다.
4. 부착이 만드는 `labeled` run 이 green 이 될 때까지 기다린다. 확인은 최신 run
   하나만 보여 주는 `gh pr checks` 가 아니라 rollup 으로 한다.

```bash
gh pr view <N> --json comments -q .comments   # 라운드의 상한. 3 미만이면 부착 불필요
# rollup 은 review-gate run 이 쌓였는지 보려고만 쓴다 — required 판정 수단이 아니다
gh pr view <N> --json statusCheckRollup \
  -q '.statusCheckRollup[] | select(.name == "review-gate") | {status, conclusion}'
```

rollup 은 이 한 곳에서만 쓴다 — **required 판정 수단이 아니다.** required 는
2단계의 `mergeStateStatus` 로 확인한다. 그 구분과 라운드 게이트의 조건 · 누가
붙이는가 · 여기서 rollup 을 봐야 하는 이유는
`.agents/skills/diagnosing-merge-gates/SKILL.md` 가 SOT 다.

## 2단계 — 머지 전 확인 (전부 통과해야 진행)

```bash
gh pr view <N> --json mergeable,mergeStateStatus,labels
# BLOCKED 일 때 어느 이름이 red 인지 좁히는 보조 — 최신 run 하나만 보여 주므로
# required 가 green 이라는 판정 근거로는 쓰지 않는다
gh pr checks <N>
```

1. `mergeStateStatus` 가 `CLEAN` 또는 `UNSTABLE` 이다 — required(`review-gate`
   포함) 충족 판정은 이 값으로 읽는다. 두 값의 뜻과 `BLOCKED` 진단 순서는
   `.agents/skills/diagnosing-merge-gates/SKILL.md` 가 SOT — `BLOCKED` 면 머지를
   시도하지 말고 그 skill 로 간다.
2. `needs:user` label 이 없고 사용자 명시 거부가 없다.
3. **PR body 를 저장된 값으로 1회 재검사한다.** `PR Body Contract` 는 push 시점
   payload 의 body 로만 돌고 body 편집으로는 다시 돌지 않는다 (기전 SOT:
   `memory/runbook/pr-merge-gates/memory.md`, 계약 SOT:
   `memory/workflow/delivery/memory.md` 「PR body」). check 가 green 이어도 그
   뒤 갈린 body 는 검사된 적이 없고, PR body 는 리뷰어와 다음 세션이 읽는 영구
   기록이다.

   ```bash
   # 패턴 목록은 옮겨 적지 말고 ci.yml 의 `PR Body Contract` job 에서 그대로 가져온다
   gh pr view <N> --json body -q .body | grep -n -F -e '<ci.yml 의 -e 목록 그대로>'
   ```

   hit 이 나오면 **머지하지 말고** 구현자에게 새 commit 을 요구한다.

하나라도 아니면 머지하지 않고 상태를 보고하고 종료한다.

## 3단계 — 머지

기본 squash body 는 PR body 가 아니라 **브랜치 커밋 메시지를 이어붙인 것이다**
(repo 설정 `squash_merge_commit_message=COMMIT_MESSAGES`). 리뷰 라운드가 뒤집은
주장이 거기 남아 있으면 그대로 main 히스토리가 된다 — 저자는 force-push 금지라 못
고치고 머지 뒤에는 아무도 못 고친다. 교정 대상의 정의와 사유는
`memory/workflow/delivery/memory.md` 「PR body」.

**커밋이 하나면 라운드 1 scorecard 만 대조한다 — 건너뛰지는 않는다.** 라운드 1 의
finding 이 그 하나뿐인 커밋 메시지를 지목할 수 있다. 커밋이 둘 이상이면 전 라운드를
대조한다. **무엇이 거짓인지 새로 판정하지 않는다 — 리뷰어가 이미 판정한 것을 커밋
메시지에서 찾는다.**

```bash
# 커밋 메시지 원문. REST 라 headline 이 안 잘린다. --paginate 가 없애는 것은 페이지
# 절단(기본 30 · per_page 로 요청해야 100)이고 이 엔드포인트 자체의 250 상한은 남는다
# — 넘으면 rc=0 · stderr 0바이트로 조용히 잘린다. #2254 의 「잘려도 아무 표시가 없다」는
# 사라진 게 아니라 임계가 30 에서 250 으로 올라간 것이다
gh api --paginate repos/Felix-LeeSM/table-view/pulls/<N>/commits \
  --jq '.[].commit.message'
gh pr view <N> --json comments -q '.comments[].body'   # 라운드별 scorecard

# scorecard 가 지목한 문구 하나가 커밋 메시지에 있는지. tr 이 하드랩을 이어 붙인다.
# LC_ALL=C 를 빼면 한국어 문구가 통째로 0 이 된다 — 기전과 표적 음절은
# memory/workflow/review/memory.md 「행동 계약」이 갖는다
# 조각에도 같은 정규화를 건다 — 안 걸면 아래 문단의 탭·개행·연속 공백에 뚫린다
NEEDLE="$(printf '%s' '<문구>' | LC_ALL=C tr -s '[:space:]' ' ')"
gh api --paginate repos/Felix-LeeSM/table-view/pulls/<N>/commits \
  --jq '.[].commit.message' | LC_ALL=C tr -s '[:space:]' ' ' | grep -c -F -- "$NEEDLE"
```

**`gh pr view` 의 `commits` 필드로 되돌리지 마라.** 그 형태가 거짓 0 을 내는 기전 셋과
왜 이 형태여야 하는지는 `memory/workflow/review/memory.md` 「행동 계약」이 SOT 다 —
리뷰어가 교정 자리를 넘길 때 쓰는 것도 같은 형태다. 그 옛 명령을 여기 그대로 붙이지
않는 이유는 금지 문구를 인용하는 것만으로 다음 노드가 복사해 갈 수 있어서다.

**조각을 손으로 줄이지 말고 위 `NEEDLE=` 처럼 정규화해라.** `tr -s '[:space:]' ' '` 는
연속 공백을 접을 뿐 아니라 탭·개행도 한 칸으로 **치환**한다. 원문 그대로의 조각은
그래서 세 방향으로 어긋난다 — 들여쓴 이어짐(연속 공백)도 탭 하나도 0 이 나고, 개행이
들면 `grep -F` 가 대안 패턴 둘로 읽어 뒷부분이 없어도 1 이 난다. **새 형태는 옛 형태의
상위집합이 아니다.** 정규화하면 문구를 안 짧게 하고도 걸린다.

**그래도 줄여야 하면 자를 자리는 공백이 아니라 연속 공백 구간이다** — 한 칸까지 빼면
조각이 짧아지고 짧을수록 무관한 PR 에 걸린다. `# 39` 를 `39` 로 줄이면 SHA `539d05f3`
와 이슈 번호 `#2239` 에 걸리는데, 걸리게 만든 것은 뗀 공백이 아니라 같이 뗀 `#` 다.
「연속 공백이 안 낀」은 hit 의 필요조건이고 충분조건이 아니다.

**hit 0 은 「커밋 메시지에 없다」의 증명이 아니다.** 정규화해도 인증 실패와 `--jq`
오타는 똑같이 0 이다. 0 이면 교정 대상에서 빼기 전에 위 원문 덤프를 육안으로 훑는다 —
0 을 잘못 믿는 값이 한쪽으로만 크기 때문이다 (같은 방).

각 라운드 scorecard 의 blocking / non-blocking 목록을 커밋 메시지와 대조한다.
**라운드 N 의 finding 이 지목한 주장이 라운드 N 이전 커밋 메시지에 그대로 남아
있으면 그것이 교정 대상이다** — 수치든 산문이든 저자의 철회문이든 같다. 하나라도
걸리면 교정본을 만들어 `--body-file` 로 대체한다.

```bash
gh pr merge <N> --squash --delete-branch                            # 대조 결과 clean
gh pr merge <N> --squash --delete-branch --body-file <교정본 경로>  # 교정할 때
```

`--squash` 는 `memory/workflow/delivery/memory.md` 「자율 실행 vs 중단」이 정한
머지 방식 기본값이다. 다른 방식이 지시되면 그 절의 중단 조건으로 간다.
머지 SHA 를 기록한다.

## 4단계 — 회수

1. **브랜치** — `--delete-branch` 가 remote 를 지운다. 사본에 체크아웃돼 있어
   로컬 브랜치 삭제가 실패하면 경고만 나온다. **무해하므로 보고만 하고 넘어간다.**
2. **사본** — 머지된 PR 의 head OID 와 사본 tip 을 대조한다. 판정 규칙 · dirty
   보존 · 절대 안 지우는 대상의 SOT 는 `memory/runbook/worktree/memory.md`
   「회수」이고, 이 preamble 은 그 판정에 필요한 값을 모으는 데까지다.

   ```bash
   gh pr view <N> --json headRefOid -q .headRefOid
   git -C "$CLONE" rev-parse HEAD
   git -C "$CLONE" status --porcelain    # 비어 있지 않으면 dirty
   ```

   세 값을 방의 판정에 넣는다. 판정이 서지 않으면 지우지 말고 보존 사유를
   보고에 남긴다.
3. **이슈** — PR body 의 `Closes #<이슈>` 로 자동 종결됐는지 확인하고, 안 됐으면
   `gh issue close <이슈>`. 삭제가 큰 머지였으면 지운 경로를 참조하는 열린 이슈를
   `git grep` · `gh issue list` 로 훑어 보고에 싣는다.

## 반환 형식

```
- PR: #<번호> — merged <머지 SHA> (squash)
- squash body: 기본(대조 clean) / 교정(뒤집힌 주장 N건)
- reflect:done: 부착 / 불필요 (라운드 <N>) — 부착했으면 labeled run 결과
- required: 머지 시점 충족 — `mergeStateStatus` = CLEAN / UNSTABLE
- PR body 재검사: clean / dirty → 머지 중단하고 새 commit 요구
- 브랜치: remote 삭제 완료 / 로컬 삭제 실패(무해)
- 사본: 삭제 / 보존(사유)
- 이슈: #<번호> closed / 이미 closed / 수동 종결 필요
- 정지 필요: 있으면 사유
```

서사 없이 위 항목만.
