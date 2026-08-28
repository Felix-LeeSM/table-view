---
name: diagnosing-merge-gates
description: PR 이 mergeable 인데 BLOCKED 이거나 merge 가 base branch policy 로 거부될 때의 진단 순서. review-gate run 고착, 라운드 게이트, 트리거 반복 함정, 그리고 이 head 에서 안 끝난 required check 를 직전 head 에서 읽는 법을 다룬다.
---

# PR merge 게이트 진단

**required context 목록과 게이트 계약은
`memory/runbook/pr-merge-gates/memory.md` 가 소유한다.** 어떤 이름이 required
인지, 무엇을 검사하는지, 무엇을 건드리면 안 되는지는 그 문서가 정한다. 이 파일은
막힌 PR 을 푸는 **진단 순서와 함정**만 담는다. 이 파일과 그 문서가 어긋나면
memory 를 따른다.

`gh pr merge` 가 BLOCKED 나 "base branch policy prohibits" 로 막힐 때는 아래
순서로 간다: 「먼저 배제할 두 오해」 → 「잘못된 대응이 만드는 함정」 →
「올바른 순서」이다.

## 먼저 배제할 두 오해

첫째, protection API 만 보고 "required 는 review-gate 뿐" 이라고 단정하지 마라.
ruleset 7종은 별도 계층이고 docs 만 바꾼 PR 에도 전부 요구된다.

둘째, `Runtime Happy Path` 가 red 면 job 로그의 `selected N specs` 를 먼저 봐라.
그 job 이 무엇을 골라 돌리는지는 `memory/runbook/pr-merge-gates/memory.md`
「각 required 가 실제로 무엇을 보나」가 소유한다.
**N=0 인데 red 면 spec 실패가 아니다.** spec 은 하나도 돌지 않았고, 원인은
`if:` 없이 항상 도는 앞 두 step 이다: `Self-test the scope map` (누가 매핑 안 된
`e2e/smoke/*.spec.ts` 를 머지하면 그 뒤 docs-only PR 까지 전부 여기서 실패한다)
이나 `Select specs for this change` (base ref 미해결 · checkout)가 그것이다.
**N>0 인데 red 면** 그 N 개 중 `FAIL <key>` 를 찍은 spec 이 원인이다.

## 잘못된 대응이 만드는 함정

- **트리거를 반복하지 마라.** `gh run rerun`(review-gate) 과 label 을 뗐다 붙이는
  반복, `gh pr update-branch` 를 섞으면 head SHA 에 review-gate check-run 이
  fail·cancelled·success 로 뒤섞여 쌓이고, 최신이 success 여도 GitHub 이 required
  판정을 풀지 못해서 BLOCKED 가 고착된다. review-gate 는 `labeled` 이벤트에서만
  success 를 낼 수 있고 opened 와 synchronize, rerun 은 fail run 을 남기며,
  `labeled` 라도 라운드 게이트에 걸리면 fail 한다 (아래에서 설명한다).
- **required 판정은 이름별 "최신 생성 check suite" 를 따른다** (#1967 실측 판정).
  `gh run rerun` 은 원래 suite 를 재사용하므로 옛 run 의 rerun 은 판정을 어느
  방향으로도 바꾸지 못한다. 게이트를 풀려면 새 이벤트(label 부착 등)로 **새
  suite** 를 만들어야 한다. `statusCheckRollup` 은 같은 이름 run 전부의 집계라
  required 판정과 다르고, `/commits/<sha>/status` 는 legacy Status 전용이라 이
  repo 에서는 항상 비어 있다.
- **auto-merge 가 켜진 PR 에 커밋을 더할 거면 먼저 꺼라.** 수정 push 가 올라가기
  전에 머지된 사례가 있다 (#1860).
- **체크가 0개면 워크플로 문제부터 보지 않는다.** `mergeStateStatus` 를 먼저 봐라.
  `DIRTY`(충돌)면 CI 는 아예 돌지 않는다.
- **update-branch(main pull)는 필요하지 않다.** branch protection
  `strict`(up-to-date)=false 이므로 behind 여도 merge 된다. update-branch 는
  synchronize 이벤트로 `review:approved` · `review:changes-requested` ·
  `reflect:done` 을 제거하기만 하고 이득이 없으며, 라운드 3 이상에서는 사용자의
  진행 승인까지 사라진다. 제거되는 label 집합의 SOT 는
  `.github/workflows/review-gate.yml` 의 "Release reflect:done on a new round" 와
  "Dismiss stale approval on new commits" 두 스텝이다.
- **CLEAN 만 기다리지 마라.** `mergeState=UNSTABLE` 은 required 가 전부 pass 하고
  non-required 만 fail 한 상태이므로 **merge 할 수 있다**. 다만
  `Dependency Security`(cargo deny / RUSTSEC)는 2026-07-05 부터 **required 로
  승격**되어서 fail 이면 BLOCKED 다. RUSTSEC 신규 advisory 때문에 본 변경과
  무관하게 막힐 수 있는데, 그 경우에는 회피가 아니라 advisory 대응(버전 bump 나
  deny.toml 예외 + 근거 주석)이 fix 다.

## review-gate run 상태 함정 (#1523/#1515 실측, 2026-07-16)

- **synchronize run 은 `gh run rerun` 해도 영원히 fail 이다.** push(synchronize)
  마다 "Dismiss stale approval on new commits" step 이 `review:approved` 와
  `review:changes-requested` 를 DELETE 하고 의도적으로 exit 1 한다 (2026-07-31
  부터 양쪽이 대칭이 되었는데, 그전에는 고친 commit 이 올라와도 red verdict
  label 이 남는 문제가 있었다). rerun 은 같은 dismissal 로직을 재실행해서 다시
  `exit 1` 을 내므로, synchronize run 은 절대 pass 로 뒤집을 수 없다. 자동 rerun 을
  대신 돌려 주는 watcher 는 없으니, label 부착 전에 review-gate bucket 이 pass
  인지 손으로 확인한다 (#1523).
- **CANCELLED 고착 (#1515, 2h timeout 의 원인)**: `labeled` run 이 concurrency 로
  CANCELLED 되면 그 이름의 최신 suite 가 non-success 인 채 남아서 BLOCKED 가
  고착된다. `gh pr checks` 는 최신 run 만 보여 주므로 all-pass 처럼 보인다. 쌓인
  run 을 **열거**할 때만 `statusCheckRollup`(GraphQL)과 commit check-runs API 를
  쓰고, required 판정은 위 「함정」이 정한 대로 최신 suite 로 읽는다 (집계는 판정이
  아니다, #1967). 해소하는 방법은 아래의 재발화뿐인데, CANCELLED 된 그 run 을
  `gh run rerun` 해도 같은 suite 를 재사용하므로 판정을 바꾸지 못한다.
- **재push 뒤 판정이 `review:approved` 인데 고착된 경우**: delta 리뷰가
  `review:approved` 인데 gate 가 fail 로 고착됐다면, 리뷰어 label 유무와 무관하게
  아래 재발화로 새 labeled run 을 만들어야 pass 로 뜬다.
- **재발화 절차는 위 두 고착에 공통이다**:
  `gh pr edit <pr> --remove-label "review:approved"` →
  **뗀 명령이 만든 review-gate run 이 완료될 때까지 대기** →
  `--add-label "review:approved"` 순으로 실행한다. 대기 없이 연속으로 실행하면
  `cancel-in-progress` 가 run 하나를 취소해서 위 CANCELLED 고착이 재발한다
  (#1879). 대기 계약의 SOT 는 `memory/workflow/review/memory.md` 「행동 계약」이다.
  라운드 3 이상이면 **두 고착 모두** 재발화만으로는 풀리지 않고 `reflect:done` 이
  먼저 필요하다 (아래에서 설명한다).
- **라운드 3 이상은 `labeled` 도 fail 한다 (2026-07-29)**: `Stop at review round 3`
  step 이 라운드 3 이상이고 `reflect:done` label 이 없으면 exit 1 한다. rerun 도
  label 재발화도 같은 상태를 재생하므로 계속 fail 이고, 해소하는 방법은
  `reflect:done` 부착뿐이며 `--admin` 으로는 넘길 수 없다 (근거는
  `memory/runbook/pr-merge-gates/memory.md` 가 소유한다).
  **누가 붙이는지는 verdict 가 가른다.** green 이면 종결자가 바로
  붙이고, red 면 회고 모드 리뷰어가 interface 를 거쳐 사용자에게 올려서 받는다
  (`memory/workflow/delivery/memory.md`). 저자는 붙이지 않는다. 게이트는 라운드만
  세고 verdict 를 보지 않으므로 green 인 PR 도 걸린다.
  **label 은 라운드 단위다 (#1968).** `Release reflect:done on a new round` 스텝이
  synchronize 마다 떼므로(해제를 재조회로 확인하고, 확인이 실패해도 exit 1 한다)
  승인을 받고 fix 를 더 push 하면 다음 라운드에서 다시 받아야 한다.
- **라운드는 서로 다른 head 커밋에 붙은 리뷰 인계의 수다 (#1968, 2026-08-01).**
  앞 스텝 `Count review rounds by head OID` 가 GraphQL 로 세서 output 으로 넘기고
  `Stop at review round 3` 이 그것을 읽는데, 웹훅 payload 에는 이 집계가 없다.
  집계가 실패하면 그 스텝이 exit 1 하므로 게이트는 red 로 닫힌다. 다시 세지 말고
  그 스텝의 `rounds=N` 을 읽어라. 코멘트 수는 라운드의 **상한**이라 3 미만이면
  라운드도 3 미만이다. 옛 정의(코멘트 1건 = 1라운드)로 잰 "머지 30건 중 16건이
  승인 시점에 `comments >= 3`" 은 새 정의로 다시 재지 않았다.
- **새로 머지한 게이트 스텝은 이미 열린 PR 에 바로 걸리지 않는다** (#1868: merge
  ref 에 `Stop at review round 3` 이 아예 없어서 두 run 이 그 스텝 없이 success 를
  냈다). 그 기전, 즉 열린 PR 이 merge ref 에서 workflow 정의를 읽는다는 사실은
  `memory/runbook/pr-merge-gates/memory.md` 「계약」이 소유한다. 여기서 할 일은
  하나다: 게이트 도입 직후에는 초록을 믿지 말고 `gh run view <id> --json jobs` 로
  step 목록을 확인한다.

## 올바른 순서

1. 리뷰를 green 으로 확보한 뒤에 CI 가 자연히 다 돌게 둔다 (트리거를 추가하지
   않는다).
2. **맨 마지막에** `review:approved` label 을 붙인다 (labeled 이벤트가 review-gate
   를 success 로 만든다). 그 뒤로 push 나 rerun, update-branch 로 SHA 와 run 을
   건드리지 않는다. 라운드 3 이상이면 `reflect:done` 이 먼저 필요한데, green 은
   종결자가 붙이고 red 는 `memory/workflow/delivery/memory.md` 의 라운드 회고를
   거친다.
3. E2E flaky fail 은 workflow run 이 완료된 뒤에 `gh run rerun <id> --failed` 를
   1회 돌린다. 그 run 이 그 이름의 최신 suite 일 때만 판정이 바뀐다 (위 「함정」).
4. `mergeState` 가 `UNSTABLE` 또는 `CLEAN` 이 되면 `gh pr merge` 를 실행한다.
   **`--admin` 으로는 넘길 수 없으므로** required 를 실제로 충족시켜야 한다. 왜
   넘길 수 없는지(`enforce_admins` · ruleset)는
   `memory/runbook/pr-merge-gates/memory.md` 「계약」이 소유한다.

## 안 끝난 check 를 직전 head 에서 읽는 법

`IN_PROGRESS` 인 required check 는 「아직 모른다」를 뜻하지 않는다. **같은 이름의
run 이 직전 head 에서 이미 결론을 냈기 때문이다.** force-push 가 hard block 이라
(`memory/workflow/git-policy/memory.md`) 브랜치 커밋 목록이 곧 지나간 head 목록이고,
head 마다 같은 이름을 읽으면 그 결론이 head 를 넘어 반복되는지가 보인다. 반복되면
`gh run rerun` 으로 뒤집힐 실패로 보지 않으며, 확정은 실패한 스텝을 읽어서 한다.

```bash
SHAS="$(gh api --paginate "repos/Felix-LeeSM/table-view/pulls/<N>/commits" -q '.[].sha')" \
  || { echo "ABORT: PR 커밋 조회 실패 — 지나간 head 목록을 못 얻었다" >&2; exit 1; }
printf '%s\n' "$SHAS" | while read -r sha; do
  printf '%s ' "$sha"
  gh api "repos/Felix-LeeSM/table-view/commits/$sha/check-runs?per_page=100" \
    -q '[.check_runs[] | select(.name=="<check 이름>")] | sort_by(.completed_at) | last | "\(.status) \(.conclusion) \(.completed_at)"'
done
```

출력은 오래된 head 부터 나오므로, 마지막 줄이 `completed` 가 아니면 위로 올라가
가장 최근 결론을 읽는다. **그 head 에 그 이름의 run 이 아예 없으면
`null null null` 이 나온다** (rc=0). 이것은 조회 실패가 아니라 「없다」는 뜻이고,
거슬러 올라가도 계속 그러면 그때가 「못 쟀다」에 해당한다. `--jq` 나 `-q` 에
`--arg` 를 붙이면 `accepts at most 1 arg(s)` 로 죽으므로 이름은 필터 안에 직접
적는다.

리뷰어가 이 값을 어디에 적고 어떻게 판정하는지는 `.agents/prompts/pr-review.md`
「자동 layer」가 정한다.

## 진단 명령

- `gh pr view <n> --json mergeable,mergeStateStatus` 로 BLOCKED 와 UNSTABLE,
  CLEAN 을 판별한다.
- `gh pr checks <n>` 에서 `Runtime Happy Path` 상태와 `review-gate` 를 확인한다.
  다만 **최신 run 만 보여 주므로** 쌓인 CANCELLED 고착을 가려서 all-pass 처럼
  나온다 (「review-gate run 상태 함정」).
- `gh api .../commits/<headSha>/check-runs` 로 review-gate run 이 여러 개 쌓였는지
  본다.

## Why

2026-07-02 세션에서는 fix PR 4개를 머지하면서 review-gate 에만 매달려 rerun 과
label 토글, update-branch 를 반복했고, 그 결과 run 이 쌓여서 수십 분 동안 BLOCKED
가 고착됐다. 실제 blocker 는 ruleset 의 E2E 였는데 protection API 에 보이지 않아서
뒤늦게 `--admin` 에러로 발견했다. UNSTABLE 을 merge 할 수 있는 상태로 인지하지
못해서 지연이 더 늘었다.

## How to apply

merge 가 막히면 그 문서의 「Required 게이트는 두 곳에 분산」 → 이 파일의 「먼저
배제할 두 오해」 → 「잘못된 대응이 만드는 함정」 → 「올바른 순서」 순으로 점검한다.
이미 run 이 뒤엉켰으면 빈 commit 으로 SHA 를 리셋하기보다 **트리거를 멈춘 뒤에**
UNSTABLE 로 안착하기를 기다렸다가 merge 한다.

## 관련

- `memory/runbook/pr-merge-gates/memory.md`: required context 목록과 게이트 계약이
  있다. 「두 곳 분산」이 그 문서에 있다.
- `memory/workflow/delivery/memory.md`: 리뷰부터 정리까지의 구간에서
  `review:approved` 와 `reflect:done` 을 누가 언제 붙이는지가 있다.
  `enforce_admins` 는 `memory/runbook/pr-merge-gates/memory.md` 「계약」이 소유한다.
- `memory/workflow/review/memory.md`: 라운드 판정과 label 대기 계약이 있다.
