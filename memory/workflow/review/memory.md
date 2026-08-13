---
title: PR Review Behavior
type: workflow-rule
updated: 2026-08-11
task: review, pr, delivery
keywords: scorecard, verdict, blocking, non-blocking, 사본이 필요한가, 설치가 필요한가, 판정 입력, 문서화 impact 게이트, review:approved, review:changes-requested, reflect:done, Stop at review round 3, head OID, head-oid, fan-out, subreviewer, 재리뷰, label 순서, 회고 모드, 라운드 3, 유형 재발 표, 저자 사본 편집 금지, 일회용 사본, 재실행, test lint build, squash body, COMMIT_MESSAGES, 커밋 메시지 대조, messageHeadline, 종결자 교정 대상, LC_ALL, LC_ALL=C, 0xA0, GNU tr, BSD tr, 로케일, gnubin, coreutils, 한글 음절, 거짓 0
trigger:
  signal: PR 생성 / 사용자가 "리뷰해" / 수정 push 후 재리뷰
  layer: index
---

# PR Review Behavior

이 방은 PR review phase에서 agent가 반드시 취해야 할 행동 계약을 둔다.
**review 방법론에는 SOT 가 없다** — 평가 차원과 profile 분기는 어디에도 없고,
리뷰어는 아래 계약만 받는다. scorecard 의 **형식 틀**만
`.agents/prompts/pr-review.md` 「반환 형식」이 갖는다 (무엇을 평가할지는 여전히
리뷰어가 세운다).

## 행동 계약

- PR이 생성되면 orchestrator가 label을 보고 독립 리뷰 coordinator를 1회
  붙인다. 저자는 자기 PR의 리뷰어를 부르지 않는다 — self-review는 편향이다.
- 리뷰 범위와 판정 기준은 리뷰어가 이 방의 계약과 PR diff 로부터 스스로 세운다.
- coordinator는 스스로 판단해 필요하면 관점별 read-only subreviewer를 fan-out
  한다 — 항상-spawn이 아니라 자율 판단이고, 소형 PR 단독 검증도 유효한 경로다.
  coordinator가 subagent로 떠 있어도 fan-out은 된다 — 중첩 spawn은 막히지
  않는다. 깊이 한도·예산·fan-out 기준을 적은 문서는 없으므로 판단은 orchestrator
  몫이다. 같은 관점 중복 spawn은 금지한다.
- subreviewer spawn이 실패하면(깊이 한도 초과나 일시적 실패) coordinator는 같은
  관점들을 순차 단독 검증으로 강등해 수행하고, scorecard에 "fan-out 불가로 단독
  강등" 사실을 명시한다.
- Coordinator와 subreviewer는 read-only다. commit, push, merge, branch 수정 금지.
- Reviewer는 **저자 사본을 편집하지 않는다.** 소스도 빌드 산출물도 거기 쓰지
  않는다 — 리뷰 전후로 저자 사본의 HEAD 와 `git status` 가 같다. test·lint·build
  를 돌려야 하면 일회용 사본을 따로 만들어 거기서 돌리고 끝나면 지운다 — 만드는
  법은 [worktree](../../runbook/worktree/memory.md) 「리뷰어 사본」이고,
  `origin/main` 을 잡는 「생성」이 아니다. 그 사본은 PR 당 하나인 작업 사본과
  별개이고, 만든 리뷰어가 같은 턴에 회수한다. **돌릴지 말지는 리뷰어 판단이고
  의무가 아니다** — 자율 실행이 이미 blocking 발견을 냈고(2026-08-06 #2190 ·
  #2195), 그 둘은 저자 표에 없던 변형이라 「저자 표를 표본 재현하라」 형태의
  의무로는 못 잡았을 것들이다(#2196). 판정 입력은 자동 gate 결과, PR diff, PR
  body, sprint contract, 필요한 active SOT 이고, 직접 돌렸으면 그 결과도 근거가 된다.
- **먼저 「사본이 필요한가」를 답하고, 예가 나온 검증에만 「설치가 필요한가」가 누가
  돌리는지를 가른다.** 앞의 답이 뒤의 답을 함의하지 않으니 축마다 따로 답한다.
  - **「사본이 필요한가」 — 아니오가 나온 검증은 subreviewer 도 coordinator 도 사본을
    만들지 않고 선 자리에서 그대로 돌린다.** 어떤 명령이 어느 쪽인지 판정하는 규칙은
    이 방에 아직 없다 — 이슈 #2299 가 세운다. 그때까지 **못 가르면 사본 쪽으로 간다**:
    틀렸을 때 값이 한쪽으로만 크다 — 사본 하나 대 조용히 틀린 판정이다.
  - **「설치가 필요한가」의 판정 입력 — 그 명령이 `pnpm install` 이나 cargo 빌드를
    부르는가.** 안 부르는 검증(`pnpm` 을 안 부르는 `scripts/*.sh`)은 subreviewer 가
    일회용 사본을 만들어 거기서 돌린다. 부르는 검증은 돌리지 말고 **돌려야 할 명령을
    coordinator 에게 반환한다** — coordinator 는 그것을 자기 사본에서 돌리거나, 안
    돌리기로 하고 scorecard 에 그 사실을 적는다. 반환 자리는
    [pr-subreview preamble](../../../.agents/prompts/pr-subreview.md) 「반환 형식」의
    독립 항목이다 — 「판단 못 한 것」은 기록이라 섞으면 실행 지시가 안 보인다.

  형용사가 아니라 명령으로 가르는 이유는 사본 디스크가 설치에서 자릿수를 바꾸기
  때문이고(`du -sh <사본>` 로 잰다), fan-out 은 그 사본을 관점 수만큼 복제한다.
  만드는 절차와 회수 의무의 SOT 는
  [worktree](../../runbook/worktree/memory.md) 「리뷰어 사본」·「책임」이고, 이 방은
  그 방이 넘긴 「언제 · 어느 노드가 만드는가」를 답한다.
- Subreview 결과는 coordinator의 입력이다. Coordinator는 PR에 직접 하나의
  통합 scorecard와 action items를 repo-relative evidence로 comment한다. 그 action
  item 중 **구현자가 수정 라운드에 반영하는 것의 경계**는 이 방이 아니라
  [delivery](../delivery/memory.md) 「Node 별 계약」이 소유한다 — 여기 복제하지 않는다.
- Blocking은 아래 사유뿐이다: 런타임·보안 / 이 PR 귀책의 거짓이 SOT에 들어감 /
  자동 layer 실패 / 문서화 impact 게이트 위반. 그 게이트의 상세는
  [documentation](../documentation/memory.md) 「Reviewer 판정」이 갖고 여기
  복제하지 않는다. 그 외 발견은 non-blocking이고 scorecard 에
  남긴다. 점수 기준은 쓰지 않는다 — 앵커가 없어 판정을 대신해 왔다.
- Blocking 판정은 coordinator 단독 권한이다. subreviewer는 발견과 근거만 내고
  severity를 붙이지 않는다. 관점을 늘려도 blocking이 늘지 않는다.
- **PR body 는 squash body 로 안 넘어간다** — 기본 squash body 는 브랜치 커밋
  메시지를 이어붙인 것이다. 그래서 교정 자리를 종결자에게 넘길 때는 그 문구가
  커밋 메시지에 있는지 먼저 대조한다:

  ```
  gh api --paginate repos/Felix-LeeSM/table-view/pulls/<N>/commits \
    --jq '.[].commit.message' | LC_ALL=C tr -s '[:space:]' ' ' | grep -c -F '<문구>'
  ```

  **`LC_ALL=C` 는 이 명령이 한국어 문구에 대해 성립하는 조건이다.** GNU `tr` 은
  UTF-8 로케일에서 바이트 `0xA0` 을 공백으로 접는다. UTF-8 한글은 3바이트이고 뒤
  두 바이트가 `0x80–0xBF` 라, `0xA0` 을 품은 음절(`절` = `EC A0 88` · `고` · `전`
  · `정` · `제` …)이 든 문구는 접힌 쪽이 원문과 안 맞아 **0 이 된다.** BSD `tr` 은
  안 접으니 `/usr/bin/tr` 이 잡히는 머신에서 통과해도 증명이 아니다 — PATH 앞에
  coreutils 의 `gnubin` 이 서면 `tr` 자체가 GNU 다. `0xA0` 이 없는 문구로 시험하면
  `LC_ALL=C` 없이도 통과해 거짓 안심을 준다. 종결자도 같은 대조를 돌리지만
  (`.agents/prompts/pr-finalize.md` 「3단계」) 기전은 이 방이 갖는다.

  hit 이면 저자가 못 고치는 자리라(force-push 가 hard block) 종결자 몫이다.
  **hit 0 은 「PR body 에만 있다」의 증명이 아니다** — 인증 실패도 `--jq` 오타도
  문구 쪽 오타도 똑같이 0 이다. 0 이면 문구를 줄여 다시 재고, 그래도 0 이면 저자
  쪽으로 적되 scorecard 에서 지우지는 않는다. 종결자가 그 목록을 다시 훑기
  때문이고(`.agents/prompts/pr-finalize.md` 「3단계」), 오판 값이 한쪽으로만 크기
  때문이다 — hit 을 잘못 믿으면 종결자가 한 번 더 볼 뿐이지만 0 을 잘못 믿으면
  못 고치는 자리가 못 고치는 노드에게 간다.
  **`gh pr view --json commits` 로 되돌리지 마라** — 거기 `messageHeadline` 은
  69자에서 낱말 한가운데를 `…` 로 자르고, `commits(first: 100)` 이라 101번째부터
  조용히 빠진다. `tr` 은 하드랩된 산문이 줄 단위 `grep` 을 빠져나가는 것을 막는다.
  무엇이 교정 대상이고 왜 종결자만 고칠 수 있는지는
  [delivery](../delivery/memory.md) 「squash body 교정」이 SOT 다.
- **라운드 3 이상은 회고 모드다.** 그 라운드에서 개별 finding 수리를 계속하는 것
  자체가 사이클 신호다 — fix 를 더 얹으라는 지적 대신 유형 재발 표(유형 × 라운드별
  건수)를 먼저 낸다. 트리거와 보고 항목은
  [orchestration](../orchestration/memory.md) §3 이 SOT 다.
- Scorecard의 차원별 판정 표는 **어떤 경우에도 생략 금지** — 요청자가 반환
  형식을 `review:approved`/`review:changes-requested` 한 줄로 좁게 지정해도,
  delta 재검증이어도 표를 출력한다.
  (2026-07-04 실제 회귀: 요청 프롬프트의 반환 형식 지정이 rubric을 밀어냄.)
- Verdict는 label로 공표한다. add와 remove를 한 명령에 같이 쓰지 않는다 — 같은
  초에 label 이벤트가 둘 나면 `cancel-in-progress`가 `review-gate` run 하나를 죽이고,
  그 이름의 최신 suite가 non-success인 채 남아 BLOCKED가 고착된다(#1879 실측).

  ```
  green: gh pr edit <N> --remove-label review:changes-requested
         뗀 명령이 만든 review-gate run 이 완료될 때까지 대기
         gh pr edit <N> --add-label review:approved
  red:   gh pr edit <N> --remove-label review:approved
         뗀 명령이 만든 review-gate run 이 완료될 때까지 대기
         gh pr edit <N> --add-label review:changes-requested
  ```

  **기다리는 것은 시간이 아니라 run 의 상태다.** 고정 초는 조건이 못 된다 —
  run 의 벽시계 시간은 job 실행(2-3초)이 아니라 runner queue 가 지배하고 queue 에는
  상한이 없다 (2026-07-29 실측 25건 중 2건이 queue 만 35s / 84s — #1907).
  **기다릴 대상은 conclusion 이 아니라 완료다** — 뗀 직후에는 대개
  `review:approved` 가 없어 그 run 이 red 로 끝난다. 뗄 label 이 애초에 없으면
  label 이벤트가 안 나서 기다릴 run 도 없다.
  명령 형태는 `.agents/prompts/pr-review.md` 「Verdict label」.

  두 방향 모두 **기존 verdict 를 먼저 떼고 새 verdict 를 나중에 붙인다.**
  red 에서 안 떼면 같은 SHA 재리뷰로 green 이 red 로 뒤집혀도 approved 가 남아
  게이트가 통과하고(`Dismiss stale approval`은 `synchronize` 전용 — #1884),
  green 에서 approved 를 먼저 붙이면 두 label 공존 창에서 red 표식이 남은 채
  게이트가 통과한다 (2026-07-31 #2036 라운드 2 정리).
- reviewer의 write는 scorecard comment 와 verdict label **둘이 전부다**
  (그 외 write 금지 — 이슈 발행 포함). non-blocking 발견은 scorecard 가
  기록이고, 이슈화는 스윕이 유형 단위(10건=1이슈, [orchestration](../orchestration/memory.md) §4)로
  한다. finding 별 개별 발행이 이슈 noise 의 주범이었다(#2005~#2022 연번,
  2026-07-31 실측 — #2035).
  `review:approved`는 `review-gate` required check의 pass 조건이다
  (계정 1개 = GitHub review approval 불가의 label 우회). **label 만으로 pass 가
  되지는 않는다** — 라운드가 3 이상인데 `reflect:done` 이 없으면 label 을
  붙여도 `Stop at review round 3` step 이 fail 시킨다
  ([diagnosing-merge-gates](../../../.agents/skills/diagnosing-merge-gates/SKILL.md) 「review-gate run 상태 함정」).
- 리뷰 대응 이력의 SOT는 PR과 scorecard다 — 소스 주석에 리뷰 라운드 서사를
  남기지 않는다. 룰 본문은 구현자가 읽는
  [god-file](../../engineering/conventions/refactoring/god-file/memory.md)
  「제거 — rot 빠른 메타」가 소유하고, `src/` `src-tauri/` `e2e/` 는
  `scripts/check-round-narrative.sh` 가 CI 에서 집행한다 (#2108, #2114).
- 결함이 있으면 orchestrator가 `review:changes-requested` label을 보고 구현자를
  다시 띄운다. 구현자가 수정하고 push하면 그 커밋에 다음 라운드 리뷰가 붙는다.
- Merge 판단은 종결자 몫이다. Reviewer pack은 판단 input만 제공한다.
- External reviewer는 사용자가 명시적으로 요청했을 때만 추가한다.

## Merge 전 요구

- 자동 gate와 CI가 green이어야 한다. `review-gate` check는
  `review:approved` label이 있어야 pass — branch protection required check +
  enforce_admins라 우회 불가. 새 commit push 시 label이 자동 해제되므로
  fix 후에는 재리뷰가 필수다.
- 라운드가 3 이상이면 `reflect:done` label 도 있어야 한다 — 없으면
  `review:approved` 가 붙어 있어도 `review-gate` 가 fail 한다. 라운드는 서로 다른
  head 커밋에 붙은 리뷰 인계의 수이고 코멘트 수는 그 **상한**이다 — 같은 커밋에
  코멘트가 셋 달려도 1라운드라 게이트가 안 막는다. `reflect:done` 은 새 커밋이
  오면 자동으로 떨어지므로 그 라운드에만 유효하다. 누가 붙이는지와 진단은
  [diagnosing-merge-gates](../../../.agents/skills/diagnosing-merge-gates/SKILL.md).
- 정성 차원에 blocking 이 없어야 한다 — 위 행동 계약의 blocking 정의를 그대로
  쓴다. 이 절은 별도 기준을 세우지 않는다.
- PR이 mergeable이고 branch policy block이 없어야 한다.
- 사용자 명시 거부가 없어야 한다.

## 관련

- [delivery](../delivery/memory.md) — 커밋 → 푸시 → PR → 리뷰 → 머지 구간의 node 별 계약
- [documentation](../documentation/memory.md) — PR body와 documentation impact gate
