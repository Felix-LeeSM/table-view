---
title: PR merge 게이트 — required context 계약
type: runbook
updated: 2026-08-27
task: merge, pr, review-gate, ci, blocked, ruleset, e2e, synchronize-rerun, cancelled-rollup, round-gate
keywords: BLOCKED, base branch policy prohibits, mergeStateStatus, UNSTABLE, CLEAN, DIRTY, review-gate, reflect:done, required check, check-runs, check suite, merge ref, rerun, cancelled, cancel-in-progress, expected, Dismiss stale approval, Release reflect:done on a new round, Count review rounds by head OID, head-oid, head OID, rounds=, round-def, statusCheckRollup, auto-merge, 체크 0개, PR Body Contract, CLAUDE.md import intact, memory/ doc size cap, check-memory-doc-size, lines >, chars >, test binaries called or allowlisted, check-ci-test-calls, ci-uncalled-tests.txt, 안 부르는데, 검사 불성립, 집계:, 다 훑지 못했다, agent contract command blocks do not swallow failures, 계약 문서의 명령 블록이 실패를 흘린다, 파이프가 의 rc 를 가린다, ABORT 를 적고 0 아닌 rc 로 안 끝난다, check-prompt-fail-silently, Frontend Checks, apt steps carry a step timeout, check-apt-timeout, apt 를 부르는데 timeout-minutes 가 없다, timeout 없는 apt 스텝, apt hang, 매달린 apt
trigger:
  signal: PR 이 mergeable 인데 mergeState=BLOCKED / merge 가 base branch policy 로 거부
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# PR merge 게이트 — required context 계약

이 방은 **어떤 이름이 required 이고 무엇을 검사하는가**를 소유한다. 막힌 PR 을
푸는 진단 순서와 함정은 `.agents/skills/diagnosing-merge-gates/SKILL.md` 가
소유한다 — **어떤 harness 도 그 파일을 자동으로 안 읽는다**: `AGENTS.md`
매트릭스와 이 포인터가 유일한 도달 경로다. 둘이 어긋나면 이 방이 이긴다. 위
`keywords:` 줄은 진단이 나간 뒤에도 **그대로 둔다** — 기본 `rg` 는 dotfile 을
빼서 `.agents/` 를 못 보므로, 에러 문자열로 찾는 쪽이 닿는 곳은 이 방이고 방이
앞으로 넘긴다. 그 줄을 "낡았다" 며 지우면 도달이 끊긴다. label 메커니즘 자체는
[delivery](../../workflow/delivery/memory.md) 의 라운드 회고 · 머지 계약이
소유한다.

## Required 게이트는 두 곳에 분산 (핵심)

1. **legacy branch protection** — `review-gate` 하나.
   `gh api repos/{o}/{r}/branches/main/protection/required_status_checks` 로
   보임.
2. **repository ruleset `pr_to_main`** — 아래 블록이 목록. ★ protection API 에
   **안 나온다**. `gh api repos/{o}/{r}/rulesets/<id>` 또는
   `gh pr merge <n> --admin` 의 에러 메시지로만 확인된다. (2026-07-03 #1183
   delivery 실측 — 이전 서술 "E2E 만" 은 불완전했음.)

**이 블록이 repo 유일의 required context 목록이다.** 다른 문서는 열거하지 말고
여기를 가리킨다. 이름이 실제 workflow job context 와 어긋나도 CI 는 조용하므로,
워크플로를 고칠 때 여기를 같이 고쳐라.

<!-- ci-gates:required-contexts -->

- 2026-07-05 1차: `Frontend Checks` · `Rust Unit And Storage Tests` ·
  `Integration Tests (Docker)` · `Runtime Happy Path` · `Dependency Security`
- 2026-07-10 2차: `Rust Static Analysis` · `PR Body Contract` (무조건 실행 +
  40여 PR green 관측 근거로 등록)
- 2026-07-31: `Detect Change Scope` 를 ruleset 과 `ci.yml` 양쪽에서 **제거**.
  현재 required context 는 **7종**이다.

<!-- /ci-gates -->

**7종 전부가 실검사다 — 빈 껍데기는 0종이다.** 마지막 name-only job 둘이
2026-07-31 에 같이 사라졌다: `Detect Change Scope` 는 ruleset 과 `ci.yml`
양쪽에서 제거됐고, `PR Body Contract` 는 실검사가 됐다. 순서는 ruleset 에서 먼저
빼고 그다음 job 삭제다 (ruleset 은 GitHub 라이브 상태라 별도 결정) —
`Detect Change Scope` 제거가 그 순서를 그대로 밟았다. 남은 job 의 `name:` 은
건드리지 마라. 이름을 지우면 컨텍스트가 영영 `expected` 로 남아 모든 머지가
막힌다.

## 각 required 가 실제로 무엇을 보나

`Runtime Happy Path` 는 2026-07-31 부터 실검사다 (#2035 wave 5).
`e2e/scope-map.mjs` 가 변경 경로에서 spec 부분집합을 고르고 그것만 돌린다 — e2e
와 무관한 PR 은 `selected 0 specs` 를 찍고 green, 나머지는 red 가 될 수 있다.

`PR Body Contract` 도 2026-07-31 부터 실검사다. PR body 에 `/Users/` · `/tmp/` ·
`file://` · `worktrees/` · `clones/` 가 있으면 그 줄을 찍고 fail 한다 (빈 body
는 pass). 계약 SOT 는 [delivery](../../workflow/delivery/memory.md) 「PR body」.
**`ci.yml` 은 `edited` 를 안 듣는다** — body 만 고치고 `gh run rerun` 해도 원래
payload 의 옛 body 를 다시 읽어 같은 자리에서 fail 한다.
**해소는 새 commit 뿐이다.**

같은 job 의 마지막 스텝 `Universal claims in PR body carry a command` (#2228) 가
body 를 한 번 더 읽는다. 트리거 낱말이 든 줄 ±6 줄 안에 명령이 없으면 그 줄 번호와
문안을 찍고 fail 한다 — 낱말 목록과 판정은 `scripts/check-pr-body-universals.sh`
헤더가 소유하고, 로컬 재현은 `gh pr view <N> --json body -q .body | bash
scripts/check-pr-body-universals.sh` 다. body 의 참·거짓은 안 본다. 위와 같은
payload 기전이라 해소는 새 commit 이다.

**같은 job 은 body 와 무관한 계약도 검사한다 — body 가 깨끗해도 red 가 된다.**
`CLAUDE.md import intact` (#2059) 는 `CLAUDE.md` 의 `@AGENTS.md` import 줄과
`AGENTS.md` 존재를 본다. `grep -q` + `test -f` 라 로그엔 exit code 만 남으니,
red 면 그 줄과 파일이 그대로인지(들여쓰기·트레일링 CR 도 red) 직접 봐라.
`memory/ doc size cap` (#2128) 은 `memory/**/memory.md` 를 270줄 / 14,000
**문자**로 잡고 `FAIL <path>: <실측> lines > 270` 을 찍는다 — fix 는 긴 절차를
`.agents/skills/` 로 내리거나 방을 쪼개는 것이다.
`src-tauri test binaries called or allowlisted` (#2113) 는 workflow 의 `--test`
밖에 있는 통합 테스트 target 을 `ci-uncalled-tests.txt` 와 대조한다 — red 면
`FAIL <이름>: …` 줄 뒤에 `집계: … (스캔 루트: …)` 를 찍어 그 실행이 무엇을
스캔했는지 같이 보여 준다. **여기서 red 는 rc 1(위반)과 rc 2(검사 불성립) 둘 다고
양쪽이 같은 모양을 낸다** — rc 2 가 아무 줄도 안 찍던 자리를 #2347 이 닫았고, 그
경우 이름 자리는 `검사 불성립` 고정이다. 스캔 루트는 `src-tauri` 아래 manifest 옆
`tests/` 전부이고(#2336), fix 는 rc 1 이면 그 테스트를 부르거나 사유를 적는 것이고
rc 2 면 그 `FAIL 검사 불성립:` 줄이 지목하는 경로다.
`no review-round narrative in source comments` (#2114) 는 `src/` · `src-tauri/` ·
`e2e/` 주석의 리뷰 라운드 표기를, `(non-blocking) job names carry
continue-on-error` (#2174) 는 그 접미사를 단 job 의 `continue-on-error: true`
누락을 본다.
`agent contract command blocks do not swallow failures` (#2403) 는 `.agents/` 와
`memory/` 의 bash 펜스에서 왼쪽 명령의 rc 를 버리는 파이프와 `ABORT` 를 적고 0 아닌
rc 로 안 끝나는 줄을 본다 — red 면 자리마다 `파이프가 ... 의 rc 를 가린다` 를 찍고
`계약 문서의 명령 블록이 실패를 흘린다` 로 닫는다. 판정 정의와 allowlist 는
`scripts/check-prompt-fail-silently.sh` 헤더가 갖는다.
이 스텝들은 body 경로 검사 뒤라 그것이 red 면 뒤가 skip 된다 —
지금 도는 스텝 목록은 `.github/workflows/ci.yml` 의 `pr-body` job 이 SOT 다.

**`Frontend Checks` 도 프론트엔드 밖의 계약 하나를 검사한다.**
`apt steps carry a step timeout` (#2502) 이 `.github/workflows/` 의 모든 스텝을
훑어 `run` 이 apt 를 부르는데 `timeout-minutes` 가 없는 자리를 찍는다 — 매달린
apt 는 스텝 안의 재시도 래퍼가 못 풀고 job budget 을 통째로 태운다. red 면 자리마다
`… 이 apt 를 부르는데 timeout-minutes 가 없다` 를 찍고 `timeout 없는 apt 스텝 N 개`
로 닫으며, rc 2(검사 불성립)는 `FAIL 검사 불성립:` 으로 시작한다. 판정 정의와 파서
선택 사유는 `scripts/check-apt-timeout.mjs` 헤더가 갖는다. `pr-body` 가 아니라 여기
있는 이유는 그 잡이 `node_modules` 를 안 깔아서다. 이 스텝은 같은 잡의
`Require test matrix success` 뒤라 shard 가 red 면 skip 된다.

## 계약 — 어기면 열린 PR 전부가 막힌다

- **BLOCKED 진단에서 먼저 배제할 이름은 이제 없다.** 위 `ci-gates` 블록의
  required 7종과 `review-gate` 가 전부 red 가 될 수 있고, 대응은 fix (clippy fix
  / 테스트 수정 / body 고쳐 재push / `CLAUDE.md` import 줄 원복 / cap 넘은 방의
  절차를 skill 로 이관) 지 회피 아님.
- **신규 required context 등록은 workflow 가 main 에 올라간 뒤에 한다.** 아무
  run 도 만들지 않는 required context 는 열린 PR 전부를 BLOCKED 로 고착시킨다.
  main 착지도 충분조건이 아니다: 열린 PR 은 merge ref 가 갱신돼야 새 workflow
  정의를 읽는다 (#1868 — skill 의 「review-gate run 상태 함정」).
- **required 를 실제로 충족시켜야 한다.** `--admin` 은 `enforce_admins=true` +
  ruleset 이라 우회 불가다.

## 관련

- [diagnosing-merge-gates](../../../.agents/skills/diagnosing-merge-gates/SKILL.md)
  — 막힌 PR 의 진단 순서 · 트리거 함정 · review-gate run 고착 · 올바른 순서
- [delivery](../../workflow/delivery/memory.md) — 리뷰~정리 구간에서
  `review:approved` · `reflect:done` 을 누가 언제 붙이나. `enforce_admins` 는
  이 방 「계약」이 갖는다
- [worktree](../worktree/memory.md) — merge 후 사본(clone) 회수
- [git-policy](../../workflow/git-policy/memory.md) — force push 금지 (집행 훅
  없음)
