---
title: PR Artifacts — PR 산출물(PR body · squash 커밋 메시지 · scorecard) 작성 규칙
type: workflow-rule
updated: 2026-09-06
task: pr, commit, squash, scorecard
keywords: PR body, PR body 틀, 이식성, portability, repo-relative, 분량, 8,000, cap, 전칭, ±6, merge-base, 앵커, squash, squash body, squash 제목, 머지 제목, 교정 대상 표면, 교정본, 뒤집힌 주장, 철회문, scorecard 대조, scorecard cap, COMMIT_MESSAGES, COMMIT_OR_PR_TITLE, --body-file, --subject, NEEDLE, LC_ALL, LC_ALL=C, 0xA0, GNU tr, BSD tr, 로케일, gnubin, coreutils, 한글 음절, 하드랩, 거짓 0, grep -c, grep -o, wc -l, 자리 수, 개수를 1 로 뭉갠다, messageHeadline, 커밋 메시지 대조, 종결자 교정 대상, PR Body Contract, staleness
trigger:
  signal: PR body 작성 / squash 머지 교정 / scorecard 작성
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# PR Artifacts — PR 산출물 작성 규칙

PR 이 남기는 산출물 — PR body, squash 커밋 메시지, scorecard — 의 작성 규칙을
둔다. 언제 누가 그 산출물을 쓰고 언제 멈추는지는 [delivery](../delivery/memory.md) 의
노드 행동 계약이, 리뷰 수행 계약은 [review](../review/memory.md) 가 소유한다. 이 방은
그 산출물의 제약과, 리뷰가 뒤집은 주장이 어느 표면에 남는지 찾아 고치는 규칙을 갖는다.

## PR body

이 절은 제약만 둔다. body 의 **형식 틀**만 `.agents/prompts/issue-implement.md`
「PR body 틀」이 갖는다 (무엇을 주장할지는 여전히 저자가 세운다). 그 파일은 구현자
spawn 에만 실리니 **다른 노드는 이 줄을 보고 직접 연다.** CI 가 집행하는 제약은
근거의 이식성 · 전칭 서술의 반증 명령 · 분량이다.
**이식성** — PR body / comment 는 GitHub 에서 열리는 repo-relative path 와 URL 만
쓴다. `/Users`, `/tmp`, `file://`, `worktrees/`, `clones/` 금지. 증거 이식성의
일반형은 [documentation](../documentation/memory.md) 「Evidence portability」다.
**분량** — body 한 벌이 8,000 문자 이하다 (#2321 · #2507). 집행은
`scripts/check-review-size-cap.sh` 이고 판정 정의와 그 수의 출처는 그 헤더가 갖는다 —
같은 cap 이 scorecard 에도 장 단위로 걸린다 (아래 「scorecard 분량 cap」).
**전칭** — 트리거
낱말이 든 줄은 ±6 줄 안에 명령을 갖고 있어야 한다 (#2228). 낱말 목록과 「±6」의 뜻은
`scripts/check-pr-body-universals.sh` 헤더가 소유하니 여기 옮겨 적지 않는다 — 규칙
자체의 SOT 는 [implementation](../implementation/memory.md) §5 다. 그 검사는 낱말
옆에 명령이 있는지만 보고 주장의 참·거짓은 안 본다.
문서화 판단은 [documentation](../documentation/memory.md).

2026-07-31 부터 PR body 는 CI 가 실제로 검사한다 — `PR Body Contract` job 이
`/Users/` · `/tmp/` · `file://` · `worktrees/` · `clones/` 를 찾으면 fail 이다
(빈 body 는 pass). 게이트라 **금지 패턴을 인용만 해도 걸린다** — 예시를 들 때는
문자열을 쪼개거나 이름으로 부르고 그대로 붙이지 마라. 해소는 새 commit 뿐이다
(body 편집으로는 재검사되지 않음 — [pr-merge-gates](../../runbook/pr-merge-gates/memory.md)).

**diff 계열 명령은 움직이는 ref 가 아니라 `"$(git merge-base origin/main HEAD)"` 에
앵커한다** — body · 이슈 · 커밋 메시지 어디든 같고, `--stat` · `--name-only` ·
삽입/삭제 줄 수가 걸린다 (rev 를 명시하는 `git grep <rev>` 류는 해당 없다).
`origin/main` 기준으로 재면 저자가 push 한 뒤 남의 PR 이 머지되는 것만으로
**저자 귀책 없이** 값이 바뀐다 — 브랜치가 손도 안 댄 파일이라도 그 파일에서
브랜치가 main 보다 뒤처져 있으면 그 diff 에 섞여 든다. 병렬 PR 이 도는 저장소라
push 와 리뷰 사이에 main 이 움직이고, 실물은 이슈 #2260 이 PR #2259 로 기록해 뒀다.
**검사하는 기계는 없다.**

**PR body 와 squash 커밋 메시지는 다음 노드가 읽는 입력이다** — 노드는 죽고 산출물만
남으니 거짓이거나 낡아진 주장은 미래 구현자·디버깅 세션의 거짓 전제가 된다 (정량 주장에
재현 명령을 붙이는 제약은 [implementation](../implementation/memory.md) §5 표가 SOT).
수정 라운드에서 낡은 주장은 **지우는 것이 기본**이다 — 그 라운드가 새로 쓰는 줄은
정의상 지난 라운드 검증 집합 밖이라, 고쳐 쓴 문장이 다음 라운드에 반증되는 것이
blocking 의 반복 공급원이었다 (#2226). 다시 쓰는 것은 지우면 정보가 사라질 때뿐이고,
그때는 추론이 아니라 명령 출력으로 쓴다 (같은 §5 표의 「수치가 추론으로 생산됨」 행).
지우든 다시 쓰든 body 편집 단독은 재검사되지 않으니 fix commit + push 와 한 세트로 간다.

## squash 커밋 교정 — 표면은 제목과 body 둘이다

**squash 가 main 히스토리에 남기는 표면은 둘이고 어느 쪽도 PR body 가 아니다.**
한쪽만 교정하면 다른 쪽으로 거짓이 그대로 나간다.

| 표면 | 무엇이 오나 | 저자가 고칠 수 있나 | 종결자의 교정 지점 |
|---|---|---|---|
| 제목 | 커밋이 하나면 그 커밋 제목, 둘 이상이면 PR 제목 (`squash_merge_commit_title=COMMIT_OR_PR_TITLE`) | 커밋 하나면 못 고친다 · 둘 이상이면 `gh pr edit --title` | `--subject` |
| body | 브랜치 커밋 메시지를 이어붙인 것 (`squash_merge_commit_message=COMMIT_MESSAGES`) | 못 고친다 | `--body-file` |

**PR body 는 squash body 로 안 넘어간다** — body 칸이 그 뜻이다. 그래서 교정 자리를
종결자에게 넘길 때는 그 문구가 커밋 메시지에 있는지 먼저 대조한다:

```bash
# 조각에도 같은 정규화를 건다 — 안 걸면 하드랩된 커밋 메시지의 탭·개행·연속 공백에 뚫린다
NEEDLE="$(printf '%s' '<문구>' | LC_ALL=C tr -s '[:space:]' ' ')"
MSGS="$(gh api --paginate repos/Felix-LeeSM/table-view/pulls/<N>/commits \
            --jq '.[].commit.message')" || { echo "ABORT: 커밋 메시지 조회 실패" >&2; exit 1; }
printf '%s\n' "$MSGS" | LC_ALL=C tr -s '[:space:]' ' ' \
  | grep -o -F -- "$NEEDLE" | wc -l
```

**`grep -c` 로 바꾸지 마라 — 앞의 `tr` 이 스트림을 개행 없는 한 줄로 만들어 그
형태는 0 아니면 1 밖에 못 낸다** (`grep -c` 는 매치 횟수가 아니라 매치된 줄 수를
센다). 위 값은 이어붙인 스트림에서 문구가 난 **자리 수**이지 커밋 수가 아니다 — 한
커밋에 두 번 있으면 커밋 하나에도 2 가 난다 (#2339: `a1194121` 하나에 값 2). 빠뜨린
자리는 main 히스토리로 가니 N 곳을 다 넘긴다 (#2354: `adac4cc6` · `6f35ac44`).

**`LC_ALL=C` 는 이 명령이 한국어 문구에 대해 성립하는 조건이다.** GNU `tr` 은
UTF-8 로케일에서 바이트 `0xA0` 을 공백으로 접는다. UTF-8 한글은 3바이트이고 뒤
두 바이트가 `0x80–0xBF` 라, `0xA0` 을 품은 음절(`절` = `EC A0 88` · `고` · `전`
· `정` · `제` …)이 든 문구는 접힌 쪽이 원문과 안 맞아 **0 이 된다.** BSD `tr` 은
안 접으니 `/usr/bin/tr` 이 잡히는 머신에서 통과해도 증명이 아니다 — PATH 앞에
coreutils 의 `gnubin` 이 서면 `tr` 자체가 GNU 다. `0xA0` 이 없는 문구로 시험하면
`LC_ALL=C` 없이도 통과해 거짓 안심을 준다.

**hit 이면 저자가 못 고치는 자리라 종결자 몫이다.** 저자가 못 고치는 이유는
force-push 가 [git-policy](../git-policy/memory.md) hard block 이라 push 된 커밋
메시지가 그대로 가기 때문이다. 리뷰가 소스와 PR body 를 고쳐도 두 표면은 거짓인 채다.
머지 뒤에는 양쪽 다 히스토리라 아무도 못 고친다. **제목 쪽 실물이 2026-08-11 #2286
이다** — 리뷰가 교정 대상으로 지목한 닫힌 개수 서술을 제목이 이고 있었고
`--body-file` 이 안 닿는 자리였다. 그때 안 샌 것은 이 계약이 아니라 그 종결자의
재량 덕이다.

**hit 0 은 「PR body 에만 있다」의 증명이 아니다** — 위 `ABORT` 가 조회 실패를 걷어낸
뒤에도 `--jq` 필드명 오타와 문구 쪽 오타는 0 이다. **줄여서 다시 재지 마라** — 짧은
조각은 무관한 PR 에 걸린다. 0 이면 저자 쪽으로 적되 scorecard 에서 지우지는 않는다.
종결자가 그 목록을 다시 훑기 때문이고(`.agents/prompts/pr-finalize.md` 「3단계」),
오판 값이 한쪽으로만 크기 때문이다 — hit 을 잘못 믿으면 종결자가 한 번 더 볼 뿐이지만
0 을 잘못 믿으면 못 고치는 자리가 못 고치는 노드에게 간다.
**`gh pr view --json commits` 로 되돌리지 마라** — 거기 `messageHeadline` 은
69자에서 낱말 한가운데를 `…` 로 자르고, `commits(first: 100)` 이라 101번째부터
조용히 빠진다. `tr` 은 하드랩된 산문이 줄 단위 `grep` 을 빠져나가는 것을 막는다.
종결자도 같은 대조를 돌리지만(`.agents/prompts/pr-finalize.md` 「3단계」) 기전은 이
방이 갖는다 — 위 스크립트가 덤프하는 커밋 메시지 원문은, 커밋이 하나일 때 제목까지
같이 덮는다. 그 제목이 곧 덤프의 첫 줄이다.

**교정 대상은 리뷰 라운드가 뒤집은 모든 주장이고 두 표면에 똑같이 걸린다 — 수치 ·
산문 · 철회된 결론.**
수치로만 좁히면 수치가 아닌 거짓이 조건에 안 걸린다. 2026-08-07 #2204 가 그
형태다 — 저자의 철회 목록이 같은 줄의 `182 → 183` 은 고치고 `the two new tests` 라는
**낱말**은 안 건드렸는데, 브랜치가 더한 테스트는 셋이었다 (라운드 2 scorecard NB2).
저자의 철회문도 주장이라 같이 본다 — 저자가 자기 거짓을 세는 구조라 목록이 빠지거나
철회문 자체가 거짓일 수 있다 (2026-08-07 #2206 라운드 2 scorecard non-blocking 3:
철회문이 "base 와 head 에서 똑같이 0건" 이라 적었는데 base 는 2건이었다).

**종결자는 무엇이 거짓인지 새로 판정하지 않는다** — 리뷰어가 이미 판정한 것을 위 두
표면에서 찾는다. **리뷰어가 안 지목한 것은 제목에서도 안 고친다.** 커밋 하나짜리
PR 의 착지 제목이 PR 제목에 있던 `(#이슈)` 를 잃는 것이 그 형태인데, 제목 형식의
SOT 는 [engineering/conventions](../../engineering/conventions/memory.md)
「커밋 메시지」이고 거기에 이슈 번호를 요구하는 줄이 없어 종결자가 새로 재단할
자리가 아니다. **닫는 것은 종결자가 아니라 저자다** — 커밋 제목에
`(#이슈)` 를 넣거나, 커밋을 하나 더 얹어 제목 출처를 자기가 `gh pr edit --title` 로
고칠 수 있는 PR 제목 쪽으로 넘긴다.
**커밋이 하나여도 대조를 통째로 건너뛰지 않는다** — 라운드 1 의
finding 이 그 하나뿐인 커밋 메시지를 지목할 수 있고, non-blocking 만 달고 라운드 1 에서
approved 되면 커밋이 둘로 늘지 않은 채 머지된다. 싼 경로는 대조 범위를 라운드 1
scorecard 하나로 줄이는 것이지 생략이 아니다. 대조 절차는
[pr-finalize preamble](../../../.agents/prompts/pr-finalize.md) 「3단계」가 갖는다.
교정본에도 위 PR body 절의 정량 주장 제약이 그대로 걸린다 (2026-07-31 PR #2023:
커밋 606c426e 의 통과 수치가 작성 뒤 스위트 확장으로 낡아, 종결자가 교정본으로
머지했다 — 2007be88).

## scorecard 분량 cap

**scorecard 한 장은 8,000 문자 이하다** (#2321 · #2507). `review-gate` 가
`## Scorecard` 로 여는 코멘트를 장마다 재고, 판정 정의 · 그 수의 출처 · 합이 아니라
장 단위인 이유는 `scripts/check-review-size-cap.sh` 헤더가 갖는다. 넘으면 그 코멘트를
줄이고 job 을 re-run 한다 — 코멘트를 API 로 다시 읽어서 새 commit 없이 풀린다
(같은 cap 이 걸린 PR body 쪽은 반대다: 위 「PR body」). **cap 을 지키는 것이 이
계약을 지키는 것은 아니다** — cap 은 잘라내기로도 만족되고 잘리는 것은 대개 결론이
아니라 근거다. scorecard 에 무엇만 싣는지의 SOT 는
[documentation](../documentation/memory.md) 「결정만 적는다」다.

## 관련

- [delivery](../delivery/memory.md) — 이 산출물을 언제 쓰고 언제 멈추나 (노드 행동 계약)
- [review](../review/memory.md) — 교정 자리를 종결자에게 넘기는 리뷰 쪽 판정
- [documentation](../documentation/memory.md) — 문서화 impact 게이트 · Evidence portability · 결정만 적는다
- [git-policy](../git-policy/memory.md) — force-push hard block
- [pr-finalize preamble](../../../.agents/prompts/pr-finalize.md) — 종결자의 대조·교정 절차
