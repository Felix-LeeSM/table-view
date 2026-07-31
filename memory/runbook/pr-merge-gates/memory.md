---
title: PR merge 게이트 진단 / 처리
type: runbook
updated: 2026-08-01
task: merge, pr, review-gate, ci, blocked, ruleset, e2e, synchronize-rerun, cancelled-rollup, round-gate
keywords: BLOCKED, base branch policy prohibits, mergeStateStatus, UNSTABLE, CLEAN, DIRTY, review-gate, reflect:done, required check, check-runs, check suite, merge ref, rerun, cancelled, cancel-in-progress, expected, Dismiss stale approval, Release reflect:done on a new round, Count review rounds by head OID, head-oid, head OID, rounds=, round-def, statusCheckRollup, auto-merge, 체크 0개
trigger:
  signal: PR 이 mergeable 인데 mergeState=BLOCKED / merge 가 base branch policy 로 거부
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# PR merge 게이트 진단 / 처리

`gh pr merge` 가 BLOCKED / "base branch policy prohibits" 로 막힐 때 원인 규명 순서.
label 메커니즘 자체는 [delivery](../../workflow/delivery/memory.md) 의 라운드 회고 ·
머지 계약이 소유 —
본 방은 **required 게이트의 숨은 위치와 잘못된 대응이 만드는 함정**만 다룬다.

## Required 게이트는 두 곳에 분산 (핵심)

1. **legacy branch protection** — `review-gate` 하나.
   `gh api repos/{o}/{r}/branches/main/protection/required_status_checks` 로 보임.
2. **repository ruleset `pr_to_main`** — 아래 블록이 목록. ★ protection API 에
   **안 나온다**. `gh api repos/{o}/{r}/rulesets/<id>` 또는 `gh pr merge <n> --admin`
   의 에러 메시지로만 확인된다.
   (2026-07-03 #1183 delivery 실측 — 이전 서술 "E2E 만" 은 불완전했음.)

**이 블록이 repo 유일의 required context 목록이다.** 다른 문서는 열거하지 말고 여기를
가리킨다. 이름이 실제 workflow job context 와 어긋나도 CI 는 조용하므로, 워크플로를
고칠 때 여기를 같이 고쳐라.

<!-- ci-gates:required-contexts -->

- 2026-07-05 1차: `Frontend Checks` · `Rust Unit And Storage Tests` ·
  `Integration Tests (Docker)` · `Runtime Happy Path` · `Dependency Security`
- 2026-07-10 2차: `Rust Static Analysis` · `PR Body Contract` (무조건 실행 +
  40여 PR green 관측 근거로 등록)
- 2026-07-31: `Detect Change Scope` 를 ruleset 과 `ci.yml` 양쪽에서 **제거**.
  현재 required context 는 **7종**이다.

<!-- /ci-gates -->

**7종 전부가 실검사다 — 빈 껍데기는 0종이다.** 마지막 name-only job 둘이
2026-07-31 에 같이 사라졌다: `Detect Change Scope` 는 ruleset 과 `ci.yml` 양쪽에서
제거됐고, `PR Body Contract` 는 실검사가 됐다. 순서는 ruleset 에서 먼저 빼고
그다음 job 삭제다 (ruleset 은 GitHub 라이브 상태라 별도 결정) — `Detect Change
Scope` 제거가 그 순서를 그대로 밟았다. 남은 job 의 `name:` 은 건드리지 마라.
이름을 지우면 컨텍스트가 영영 `expected` 로 남아 모든 머지가 막힌다.

`Runtime Happy Path` 는 2026-07-31 부터 실검사다 (#2035 wave 5). `e2e/scope-map.mjs`
가 변경 경로에서 spec 부분집합을 고르고 그것만 돌린다 — e2e 와 무관한 PR 은
`selected 0 specs` 를 찍고 green, 나머지는 red 가 될 수 있다.

`PR Body Contract` 도 2026-07-31 부터 실검사다. PR body 에 `/Users/` · `/tmp/` ·
`file://` · `worktrees/` · `clones/` 가 있으면 그 줄을 찍고 fail 한다 (빈 body 는
pass). 계약 SOT 는 [delivery](../../workflow/delivery/memory.md) 「PR body」.
**`ci.yml` 은 `edited` 를 안 듣는다** — body 만 고치고 `gh run rerun` 해도 원래
payload 의 옛 body 를 다시 읽어 같은 자리에서 fail 한다. **해소는 새 commit 뿐이다.**

**같은 job 이 body 와 무관한 두 번째 계약도 검사한다 (#2059 부터).**
`CLAUDE.md import intact` 스텝이 `CLAUDE.md` 의 `@AGENTS.md` import 줄과
`AGENTS.md` 파일 존재를 본다 — body 가 깨끗해도 둘 중 하나가 깨지면 같은
required context 가 red 다. 스텝은 실패해도 메시지를 안 찍으므로(`grep -q` +
`test -f`) 로그엔 exit code 만 남는다. red 면 두 가지를 직접 확인해라: `CLAUDE.md`
에 `@AGENTS.md` 하나만 있는 줄이 그대로인가(들여쓰기·트레일링 CR 도 red),
`AGENTS.md` 가 있는가. fix 는 body 가 아니라 그 줄 · 그 파일 복구다. 이 스텝은
body 스텝 뒤라 body 가 red 면 skip 된다 — body 를 먼저 고쳐야 import 판정이 나온다.

**BLOCKED 진단에서 먼저 배제할 이름은 이제 없다.** 위 `ci-gates` 블록의 required 7종과
`review-gate` 가 전부 red 가 될 수 있고, 대응은 fix (clippy fix / 테스트 수정 /
body 고쳐 재push / `CLAUDE.md` import 줄 원복) 지 회피 아님.
신규 required context 등록은 workflow 가 main 에 올라간 **뒤에** 한다 — 아무 run 도 만들지 않는 required
context 는 열린 PR 전부를 BLOCKED 로 고착시킨다. main 착지도 충분조건이 아니다: 열린 PR 은
merge ref 가 갱신돼야 새 workflow 정의를 읽는다 (#1868, 아래 「review-gate run 상태 함정」).

→ protection API 만 보고 "required 는 review-gate 뿐" 이라 단정하지 말 것. ruleset
7종은 별도 계층이고 docs 만 바꾼 PR 에도 전부 요구된다.

→ `Runtime Happy Path` 가 red 면 job 로그의 `selected N specs` 를 먼저 봐라.
**N=0 인데 red 면 spec 실패가 아니다** — spec 은 하나도 안 돌았고, 원인은
`if:` 없이 항상 도는 앞 두 step 이다: `Self-test the scope map` (누가 매핑 안 된
`e2e/smoke/*.spec.ts` 를 머지하면 그 뒤 docs-only PR 까지 전부 여기서 죽는다) 이나
`Select specs for this change` (base ref 미해결 · checkout). **N>0 red 면** 그
N 개 중 `FAIL <key>` 를 찍은 spec 이 원인이다.

## 잘못된 대응이 만드는 함정

- **트리거 반복 금지**: `gh run rerun`(review-gate) / label remove→add 반복 /
  `gh pr update-branch` 를 섞으면 head SHA 에 review-gate check-run 이
  fail·cancelled·success 로 뒤섞여 쌓이고, 최신이 success 여도 GitHub 이 required
  판정을 못 풀어 BLOCKED 가 고착된다. review-gate 는 `labeled` 이벤트에서만 success 를
  낼 수 있고 opened/synchronize/rerun 은 fail run 을 남긴다 — `labeled` 라도 라운드
  게이트에 걸리면 fail 한다 (아래).
- **required 판정은 이름별 "최신 생성 check suite" 를 따른다** (#1967 실측 판정).
  `gh run rerun` 은 원래 suite 를 재사용하므로 옛 run 의 rerun 은 판정을 어느
  방향으로도 못 바꾼다 — 게이트를 풀려면 새 이벤트(label 부착 등)로 **새 suite** 를
  만든다. `statusCheckRollup` 은 동명 run 전부의 집계라 required 판정과 다르고,
  `/commits/<sha>/status` 는 legacy Status 전용이라 이 repo 에선 항상 비어 있다.
- **auto-merge 가 켜진 PR 에 커밋을 더할 거면 먼저 끈다** — 수정 push 가 올라가기
  전에 머지된 사례가 있다 (#1860).
- **체크가 0개면 워크플로 문제부터 보지 않는다.** `mergeStateStatus` 를 먼저 봐라 —
  `DIRTY`(충돌)면 CI 는 아예 안 돈다.
- **update-branch(main pull) 불필요**: branch protection `strict`(up-to-date)=false →
  behind 여도 merge 된다. update-branch 는 synchronize 이벤트로 `review:approved` ·
  `review:changes-requested` · `reflect:done` 을 떨구기만 하고 이득이 없다 — 라운드 3
  이상에서는 사용자 진행 승인까지 날아간다. 떼는 label 집합의 SOT 는
  `.github/workflows/review-gate.yml` 의 "Release reflect:done on a new round" 와
  "Dismiss stale approval on new commits" 두 스텝이다.
- **CLEAN 만 기다리지 말 것**: `mergeState=UNSTABLE` = required 전부 pass +
  non-required 만 fail → **merge 가능**. ※ `Dependency Security`(cargo deny / RUSTSEC)는
  2026-07-05 부터 **required 로 승격** — fail 이면 BLOCKED. RUSTSEC 신규 advisory 로
  본 변경과 무관하게 막힐 수 있다 → 그 경우 회피가 아니라 advisory 대응(버전 bump /
  deny.toml 예외 + 근거 주석)이 fix 다.

## review-gate run 상태 함정 (#1523/#1515 실측, 2026-07-16)

- **synchronize run 은 `gh run rerun` 해도 영원히 fail** — push(synchronize) 마다
  "Dismiss stale approval on new commits" step 이 `review:approved` 와
  `review:changes-requested` 를 DELETE + 의도적 exit 1 (2026-07-31 부터 대칭 —
  고친 commit 이 올라와도 red verdict label 이 남던 문제). rerun 은 같은 dismissal
  로직을 재실행해 다시 `exit 1` — synchronize run 은 절대 pass 로 못 뒤집는다.
  자동 rerun 을 대신 돌려 주는 watcher 는 없으니, label 부착 전에 review-gate
  bucket 이 pass 인지 손으로 확인한다 (#1523).
- **CANCELLED 고착 (#1515, 2h timeout 원인)**: `labeled` run 이 concurrency 로 CANCELLED
  되면 그 이름의 최신 suite 가 non-success 인 채 남아 BLOCKED 가 고착된다. `gh pr checks`
  는 최신 run 만 보여줘 all-pass 처럼 보인다 — 쌓인 run 을 **열거**할 때만
  `statusCheckRollup`(GraphQL)·commit check-runs API 를 쓰고, required 판정은 위
  「함정」대로 최신 suite 로 읽는다 (집계는 판정이 아니다, #1967). 해소는 아래 재발화뿐 —
  CANCELLED 된 그 run 을 `gh run rerun` 해도 같은 suite 를 재사용해 판정을 못 바꾼다.
- **재push 뒤 판정이 `review:approved` 인데 고착**: delta 리뷰가 `review:approved` 인데
  gate 가 fail 로 고착이면, 리뷰어 label 유무와 무관하게 아래 재발화로 새 labeled run 을
  만들어야 pass 로 뜬다.
- **재발화 절차 — 위 두 고착 공통**: `gh pr edit <pr> --remove-label "review:approved"`
  → **뗀 명령이 만든 review-gate run 이 완료될 때까지 대기** →
  `--add-label "review:approved"`. 대기 없이 연속으로 치면 `cancel-in-progress` 가
  run 하나를 죽여 위 CANCELLED 고착이 재발한다 (#1879). 대기 계약의 SOT 는
  [review](../../workflow/review/memory.md) 「행동 계약」.
  라운드 3 이상이면 **두 고착 다** 재발화만으로 안 풀린다 — `reflect:done` 이 먼저다 (아래).
- **라운드 3 이상은 `labeled` 도 fail (2026-07-29)**: `Stop at review round 3` step 이
  라운드 3 이상이고 `reflect:done` label 이 없으면 exit 1 한다. rerun 도 label
  재발화도 같은 상태를 재생하므로 계속 fail — 해소는 `reflect:done` 뿐이다
  (`enforce_admins=true` 라 `--admin` 우회 없음). **누가 붙이냐는 verdict 가 가른다** —
  green 이면 종결자가 바로 붙이고, red 면 회고 모드 리뷰어가 interface 를 거쳐
  사용자에게 올려 받는다 ([delivery](../../workflow/delivery/memory.md)). 저자는 붙이지
  않는다. 게이트는 라운드만 세고 verdict 를 안 보므로 green 도 걸린다.
  **label 은 라운드 단위다 (#1968)** — `Release reflect:done on a new round` 스텝이
  synchronize 마다 떼므로(해제를 재조회로 확인하고 확인 실패도 exit 1), 승인을 받고
  fix 를 더 push 하면 다음 라운드에서 다시 받아야 한다.
- **라운드 = 서로 다른 head 커밋에 붙은 리뷰 인계의 수다 (#1968, 2026-08-01).**
  앞 스텝 `Count review rounds by head OID` 가 GraphQL 로 세서 output 으로 넘기고
  `Stop at review round 3` 이 그것을 읽는다 — 웹훅 payload 에는 이 집계가 없다.
  집계가 실패하면 그 스텝이 exit 1 하므로 게이트는 red 로 닫힌다. 다시 세지 말고
  그 스텝의 `rounds=N` 을 읽어라 — 코멘트 수는 라운드의 **상한**이라 3 미만이면
  라운드도 3 미만이다. 옛 정의(코멘트 1건 = 1라운드)로 잰 "머지 30건 중 16건이
  승인 시점에 `comments >= 3`" 은 새 정의로 다시 재지 않았다.
- **새로 머지한 게이트 스텝은 이미 열린 PR 에 바로 안 걸린다** — `pull_request` run 은
  PR 의 merge ref 에서 workflow 정의를 읽고, 그 merge ref 는 base 보다 낡아 있을 수 있다
  (#1868: merge ref 에 `Stop at review round 3` 이 아예 없어 두 run 이 그 스텝 없이
  success). 게이트 도입 직후에는 초록을 믿지 말고 `gh run view <id> --json jobs` 로
  step 목록을 확인한다.

## 올바른 순서

1. 리뷰 green 확보 → CI 를 자연히 다 돌게 둔다 (트리거 추가 X).
2. **맨 마지막에** `review:approved` label 부착 (labeled → review-gate success).
   그 뒤로 push/rerun/update-branch 로 SHA·run 을 건드리지 않는다.
   라운드 3 이상이면 `reflect:done` 이 먼저 필요하다 — green 은 종결자가 붙이고,
   red 는 [delivery](../../workflow/delivery/memory.md) 의 라운드 회고를 거친다.
3. E2E flaky fail 은 workflow run 완료 후 `gh run rerun <id> --failed` 1회 — 그 run 이
   그 이름의 최신 suite 일 때만 판정이 바뀐다 (위 「함정」).
4. `mergeState` 가 `UNSTABLE` 또는 `CLEAN` 이 되면 `gh pr merge`.
   (`--admin` 은 `enforce_admins=true` + ruleset 이라 우회 불가 — required 를 실제로
   충족시켜야 한다.)

## 진단 명령

- `gh pr view <n> --json mergeable,mergeStateStatus` — BLOCKED/UNSTABLE/CLEAN 판별
- `gh pr checks <n>` 에서 `Runtime Happy Path` 상태 + `review-gate` 확인 — 단 **최신 run
  만 보여준다**: 쌓인 CANCELLED 고착을 가려 all-pass 처럼 나온다 (「review-gate run 상태 함정」)
- `gh api .../commits/<headSha>/check-runs` — review-gate run 이 여러 개 쌓였는지

## Why

2026-07-02 세션: 4개 fix PR merge 시 review-gate 에만 집착해 rerun/label토글/
update-branch 를 반복 → run 이 쌓여 수십 분 BLOCKED 고착. 실제 blocker 는 ruleset 의
E2E 였고 protection API 에 안 보여 뒤늦게 `--admin` 에러로 발견. UNSTABLE 을 merge 가능
상태로 인지 못해 추가 지연.

## How to apply

merge 막히면 위 "두 곳 분산" → "함정" → "올바른 순서" 순으로 점검. 이미 run 이 엉켰으면
빈 commit 으로 SHA 리셋보다 **트리거를 멈추고** UNSTABLE 로 안착하길 기다린 뒤 merge.

## 관련

- [delivery](../../workflow/delivery/memory.md) — 리뷰~정리 구간의 review-gate label / enforce_admins 계약
- [worktree](../worktree/memory.md) — merge 후 사본(clone) 회수
- [git-policy](../../workflow/git-policy/memory.md) — force push 금지 (집행 훅 없음)
