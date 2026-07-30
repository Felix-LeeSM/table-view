---
name: handoff
description: node 사이의 인계를 쓰고 읽고 다음 상태를 라우팅한다. 이슈 코멘트 append + label 갱신(write), 나에게 온 최신 인계 검증(read), label 로 다음 상태 5종 판정(state). 작업을 시작할 때 · 끝내고 죽기 전에 · 다음에 무엇을 띄울지 정할 때 사용.
---

# Handoff

각 역할이 `gh issue comment` 를 손으로 치면 인계 형식이 갈린다. 같은 규칙 본문이
여러 곳에 복제되면 서로 어긋난다 — 이 저장소가 이미 겪는 실패다. **한 곳에만
구현하고 나머지는 그걸 부른다.** 그 한 곳이 `scripts/handoff.mjs` 다.

설계 SOT: issue #1918 (§6 라우팅 · §7 스키마 · §8 3연산), #1922 (라우팅 표).

## 세 연산

```sh
node scripts/handoff.mjs read  --stage <역할> --issue N
node scripts/handoff.mjs write --stage <역할> --issue N [--pr M] [label 옵션]
node scripts/handoff.mjs state --issue N
```

`write` 는 인계 YAML 을 표준입력으로 받는다. label 옵션은 둘, 반복 가능하고
**이슈에만** 적용된다:

- `--add-label <L>` — 이슈에 붙인다
- `--remove-label <L>` — 이슈에서 뗀다 (뗄 것을 먼저 뗀다)

역할: `issue-refine` · `issue-implement` · `pr-reviewer` · `round-reflect` ·
`pr-finalize` · `user`. #1918 의 한국어 표기(구현자·리뷰어·회고자·종결자·명세
작성자·사용자)도 그대로 받는다.

**`read` 가 첫 행동이다.** "받은 판정이 낡았다", "필드가 비었다"는 받는 쪽이 자기
입력을 볼 때 처음 안다 — 보낸 쪽은 자기가 뭘 빠뜨렸는지 모른다. (시작 지점을 훅으로
강제할지는 #1943 이 재고 있다. 지금은 지시다.)

**`write` 가 마지막 행동이다.** 쓰고 죽는다. 코멘트가 먼저 올라가고 그 다음
`wip:<node>` 가 풀린다 — 사이에서 죽으면 label 이 남아 다음 node 가 "앞 시도가
죽었다" 로 읽는다.

## exit 코드가 다음 행동을 정한다

| code | 뜻 | 어떻게 |
|---|---|---|
| 0 | 통과 | 일을 시작/종료한다 |
| 1 | 거부 (스키마·사용법·키 충돌) | 메시지가 무엇이 없는지/무엇이 겹치는지 말한다. 고쳐서 다시 쓴다. **아무것도 안 올라갔고 `wip:` 도 그대로다** |
| 2 | 외부 명령 실패 | `gh`/`git` 출력 그대로. 재시도 전에 원인을 본다 |
| 3 | `RETRY` | 판정이 낡았다 (`at` 이 PR head 의 조상). 리뷰를 다시 돈다 |
| 4 | `USER` | 사용자에게 올린다. **재시도로 안 고쳐진다** |

필드 누락의 재시도 상한은 **0** 이다 — `write` 가 이미 검증하므로 읽을 때 누락이면
스킬 우회 / 스키마 버전 불일치 / 스킬 버그 셋 중 하나다.

## 인계 골격

```yaml
handoff:
  v: 1
  from: pr-reviewer            # --stage 와 같아야 한다
  to: issue-implement
  subject: pr/1905             # pr/<번호> 또는 issue/<번호>
  at: 2420164486b0ccedd2fae3fe41c4e35eed897e6c        # 판정 대상. full OID 40자
  base_oid: 2826a660962382306f3578f9d6268162e8968b65  # 기록만. 무효화 트리거 아님
  run_id: pr1905-review-2420164 # 외부 쓰기 멱등 키. 라운드가 아니라 **시도** 단위
  verdict: red                 # findings 가 있으면 필수. green|red
  findings:
    - id: B1
      severity: blocking       # blocking|note
      where: scripts/x.sh:90
      evidence:
        cmd: "awk -f r2.awk base-review.md | wc -l"   # cmd/got/want 필수
        got: "0"
        want: "1 이상"
        control:               # 전수 주장일 때만. 필터를 뺀 대조군
          cmd: "git grep -c X -- ."
          got: "1600"
      action:
        type: sweep            # sweep|fix|fixture|none
        cmd: "bash scripts/x.sh"
      fixture: |               # 뚫은 입력. 다음 라운드가 파일로 저장한다
        ...
  observations:
    - where: .github/workflows/review-gate.yml:9
      note: "labeled 트리거에 label 이름 필터 없음"
```

무엇이 필수인지는 **`write` 의 거부 메시지가 판정한다.** 여기 골격은 요약이 아니라
출발점이다 — 검증기가 `누락: handoff.findings[0].evidence.want` 처럼 자리를 찍어준다.

**`run_id` 는 시도 단위다.** 멱등 키는 `(from, to, subject, run_id)` 이고, 같은 키로
**다른 내용**을 쓰면 거부한다(exit 1) — 조용히 스킵하면 새 판정이 버려진 채 `wip:`
만 풀려서 다음 node 가 낡은 인계를 다시 읽는다. 라운드 이름(`pr1905-r2-review`)을
키로 쓰면 `RETRY` 로 다시 돈 재리뷰가 정확히 그 상태가 되므로, PR 단계에선 `at` 앞
7자를 붙여라(`pr1905-review-2420164`). head 가 움직이면 키가 저절로 바뀐다.

`at` 은 **full OID** 다. short OID 는 저장소가 커지면 접두사가 충돌하고 8자는 이미
다른 개체와 겹칠 수 있다. `at` 은 **PR head** 와 대조된다(로컬 HEAD 가 아니다) —
구현자의 미푸시 커밋은 그 판정에 대한 응답이지 판정을 낡게 만들지 않는다.
PR 이 없는 티켓 단계엔 `at` 이 필요 없다.

## `state` 의 반환은 5종

| 반환 | 뜻 | orchestrator 가 |
|---|---|---|
| `RUN <역할>` | 띄울 node 가 있다 | spawn |
| `WAIT <이유>` | 기계가 끝나기를 기다린다 | 다음 순회로 |
| `BLOCKED <이유>` | 사람 결정을 기다린다 | 사용자에게 올림 |
| `BROKEN` | 어느 줄에도 안 맞는다. 라우팅 구멍 | 사용자에게 올림 |
| `DONE` | 이슈가 닫혔다 | 큐에서 뺌 |

`WAIT` 와 `BROKEN` 을 가르는 게 이 반환의 존재 이유다. 뭉치면 정상 대기와 라우팅
구멍이 관측상 같아진다 — 둘 다 조용한데 후자는 영원히 안 풀린다.

**라우팅 표 자체는 `scripts/handoff.mjs` 의 `route()` 가 소유한다.** 산문 사본을
만들지 마라. 표가 두 곳에 있으면 갈린다.

## Boundaries

- **저장소가 PUBLIC 이라 신뢰 경계가 있다.** `read` 는 `authorAssociation` 이
  `OWNER`/`MEMBER`/`COLLABORATOR` 인 코멘트의 인계만 받는다. 그 밖의 인계 블록은
  거부하고 stderr 로 누구 것을 왜 버렸는지 낸다 — 인계는 받는 node 가 돌릴
  `action.cmd` 를 실어 나르므로 아무나 쓴 것을 권위 있는 입력으로 볼 수 없다.
- **PR 의 verdict label 은 이 스킬이 안 건드린다.** `review-gate` 가 PR label
  이벤트마다 돌고 `cancel-in-progress` 라, 같은 초에 이벤트가 둘 나면 run 하나가
  죽고 그 죽은 run 때문에 BLOCKED 가 고착된다 (#1879 실측). 그래서 verdict 전환은
  먼저 떼고 30초 이상 기다렸다 붙이는 절차가 필요하고, 그 절차는 리뷰어가
  소유한다 (`memory/workflow/review/memory.md`). 여기 label 옵션은 이슈 전용이다.
- **label 은 상태, 코멘트는 내용.** orchestrator 는 앞의 것만 본다. 코멘트를 읽기
  시작하면 판단을 하게 되고, 판단하면 다시 상태를 쌓는 존재가 된다.
- `run_id` 는 외부 쓰기 3곳(`gh issue comment` / `gh pr comment` /
  `gh issue create`)의 멱등 키다. **이 스킬이 소유하는 자리는 첫 번째 하나다** —
  리뷰어의 scorecard 와 non-blocking 배출은 `pr-review` skill 쪽이다. label
  add/remove 에는 안 붙는다(GitHub API 가 이미 멱등).
- `base_oid` 는 **기록만** 한다. 무효화 트리거로 쓰면 머지 60건 중 34건(57%)이
  재리뷰로 가고, 정작 그 사고(#1937)는 못 잡는다.
- agent 정의(`.claude/agents/` · `.codex/agents/`)의 `skills:` 배선은 #1928 이
  소유한다. 이 스킬은 스스로를 걸지 않는다.

## Related

- `scripts/handoff.mjs` — 세 연산과 라우팅 표의 구현 (SOT)
- `scripts/hooks/policy/test-handoff.sh` — 회귀 + mutation 증명
- `memory/workflow/delivery/memory.md` — node 별 행동 계약
- `.agents/skills/pr-review/SKILL.md` — 리뷰어의 판정 방법론
