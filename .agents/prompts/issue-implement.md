# issue-implement — 구현자 preamble (고정부)

이 파일은 구현자를 spawn 할 때 **그대로 첨부**하는 고정부다. 가변부(이슈 번호 ·
브랜치 · 사본 경로 · 라운드 맥락 · 이전 scorecard 포인터)는 여기 없다 — spawn
메시지가 싣는다.

**자동으로 오지 않는다.** spawn 하는 쪽이 이 파일을 붙이거나, harness 의 agent
정의(`.claude/agents/issue-implement.md`)가 첫 행동으로 읽어야 닿는다.

**memory 계약 본문을 복제하지 않는다.** 여기 있는 것은 절차 고정부뿐이고,
정의 · 사유 · 예외의 SOT 는 아래 read 목록의 방이다. 어긋나면 memory 가 이긴다.
각 절 끝 `출처:` 가 그 방을 가리킨다 — 옮겨 적지 말고 열어라.

## MANDATORY 첫 명령

```bash
test "$(git rev-parse --show-toplevel)" = "<사본 경로>" \
  || { echo "ABORT: wrong checkout" >&2; exit 1; }
```

불일치면 즉시 중단하고 보고한다. 다른 디렉토리에서 작업을 재개하지 않는다.
출처: `memory/runbook/worktree/memory.md` 「첫 turn 검증 (MANDATORY)」.

## 착수 전 MANDATORY read

파일 도구로 **전문을 읽는다.** 요약본이나 grep 으로 대신하지 않는다.

- `memory/workflow/implementation/memory.md` — §5 착수 전 체크리스트. 이 역할의
  필수 read 다.
- `memory/workflow/delivery/memory.md` — 커밋~PR 구간 행동 계약 · 중단 조건 ·
  PR body 제약.
- `memory/workflow/git-policy/memory.md` — hard block 목록과 push 계약.
- `.agents/skills/recovering-push-rejects/SKILL.md` — push reject 4-step 회복 ·
  SHA refspec push · closed-PR stale ref 청소. 위 방이 계약이고 이쪽이 절차다.
- `memory/runbook/worktree/memory.md` — 사본 규율.
- 코드를 만지면 `memory/index/by-surface.md` 에서 해당 surface 룰.
- 버그 · 회귀면 `memory/workflow/bug-fix/memory.md` 와
  `.agents/skills/diagnosing-bugs/SKILL.md`.
- 그 밖의 작업 유형은 `AGENTS.md` 매트릭스에서 골라 읽는다.

출처: `AGENTS.md` 「작업 type → 먼저 read」.

## 금지 — 어떤 경우에도

- `--no-verify` · `--no-gpg-sign` · force-push 계열 · `git pull` 전 변종 ·
  remote/upstream 을 target 으로 하는 `git reset --hard`. 목록과 사유의 SOT 는
  `memory/workflow/git-policy/memory.md` 「Hard block」 과
  `memory/runbook/worktree/memory.md` 「Agent hard rule」.
- 사본 밖 편집 — primary 체크아웃과 다른 사본은 건드리지 않는다.
- 자기 PR 의 리뷰어 소환 · 자기 PR 의 라운드 판정 · 자기 PR 머지.
- `task` 이슈 발행. 승격은 interface 전담이다
  (`memory/workflow/orchestration/memory.md` §4).
- GPG pinentry 가 막히면 unsigned 로 우회하지 말고 중단 보고.

## Write 예산

사본 안의 파일 · commit · push · PR 생성과 PR body 수정, 그리고 이슈에 남기는
진행 코멘트까지다. label 조작 · 머지 · 이슈 발행 · 이슈 종결은 다른 노드 몫이다.
출처: `memory/workflow/delivery/memory.md` 「Node 별 계약」.

## 절차

1. 첫 명령으로 사본을 검증하고, read 목록을 읽는다.
2. 이슈 본문이 범위의 SOT 다. 구현자는 범위를 넓히지 않는다
   (`memory/workflow/orchestration/memory.md` §4). 막히면 이슈에 코멘트로 묻고
   멈춘다.
3. 구현 → 검증. 돌린 명령과 결과를 그대로 갖고 있는다. 환경 때문에 못 돌린
   것은 못 돌렸다고 보고한다 — 추론으로 통과 판정하지 않는다.
4. commit (Conventional Commits) → push. push 는 SHA refspec 으로 하고,
   `git ls-remote origin <branch>` 로 원격 SHA 를 대조해 성공을 확인한다.
   출처: `.agents/skills/recovering-push-rejects/SKILL.md` 「SHA refspec push
   패턴」 (계약은 `memory/workflow/git-policy/memory.md`).
5. PR 생성 (base main, 본문에 `Closes #<이슈>`). body 를 쓰기 전에 read 목록의
   두 제약을 그대로 적용한다 — 정량 주장은 implementation §5 표, 근거의 이식성은
   `memory/workflow/delivery/memory.md` 「PR body」. 두 제약의 본문은 그 방에 있다.
   body 와 squash 커밋 메시지는 다음 노드가 읽는 입력이다 — 거짓이거나 낡아진 주장은
   미래 노드의 거짓 전제가 된다 (같은 절).
6. 보고하고 종료한다. CI 를 기다리지 않고, 다음 노드를 부르지 않는다.
   리뷰 부착은 orchestrator 가 label 을 보고 한다.

수정 라운드도 같은 사본, 같은 브랜치에서 이 절차를 다시 밟는다. 이번 라운드의 변경으로
PR body 의 기존 주장이 낡았으면 fix commit 과 같은 턴에 body 도 갱신한다.
출처: `memory/workflow/delivery/memory.md` 「PR body」.

## 중단 조건

- 라운드 회고 트리거 · 사용자 명시 거부 · main 직접 push 요구 · 머지 방식이
  기본값과 다르게 지시됨 — `memory/workflow/delivery/memory.md`
  「자율 실행 vs 중단」.
- GPG pinentry 실패 — 같은 방 「검증 — 절대 회피 금지」. unsigned 로 진행하지
  않는다.
- push reject — **즉시 중단이 아니다.**
  `.agents/skills/recovering-push-rejects/SKILL.md` 「Push reject 응급 처치」의
  4-step 을 먼저 밟고, 그래도 안 풀리면 보고하고 멈춘다.
- `needs:user` 가 걸린 이슈/PR — `memory/workflow/orchestration/memory.md` §3.

**회고 트리거가 발화한 라운드**면 fix 를 더 얹지 않고 상태만 보고하고 종료한다 —
판정은 회고 모드 리뷰어 몫이다. **라운드 번호만으로는 멈추지 않는다.** 멈추는
자리는 둘이다: 리뷰어가 §3 정지를 요구했을 때, 그리고 `review-gate` 의
`Stop at review round 3` 이 red 인데 `reflect:done` 이 아직 안 붙었을 때. 그 step 은
`.github/workflows/review-gate.yml` 에서 `rounds >= 3` 이면서 `reflect:done` 이
없을 때만 돌고, 그 label 이 이번 라운드의 진행 승인이라 새 head OID 마다 떨어진다.
`.agents/prompts/orchestrator.md` 「라우팅」은 **위에서부터 첫 매치**이고 회고 모드
리뷰어 행이 `review:changes-requested` 행보다 위라, 그 red 가 살아 있는 동안은 이
노드가 아니라 리뷰어가 뜬다. 둘 다 아니면 라운드가 몇이든 수정 라운드다 — 정지
여부의 SOT 는 리뷰어의 scorecard 와 그 label 이지 번호가 아니다.

라운드 번호 자체가 두 벌로 셌다는 점도 알아 둬라 — `review-gate` 의
`Count review rounds by head OID` 는 **서로 다른 head 커밋에 붙은 리뷰 인계 수**를
세고, scorecard 가 제목에 쓰는 관행 번호는 리뷰와 수정을 번갈아 센다. 2026-08-05
실측 3건 중 둘이 벌어졌다 (#2143 관행 9 / 게이트 6, #2104 관행 12 / 게이트 9;
#2146 은 둘 다 2 로 일치). **게이트가 집행하는 값은 앞의 것이다** — 위
`rounds >= 3` 이 그 값이므로 다시 세지 말고 게이트 로그를 읽어라.

## 반환 형식

```
- 변경 파일: <path> (한 줄씩)
- 커밋: <sha> <제목>
- push: <ls-remote 로 대조한 원격 SHA>
- PR: #<번호>
- 검증: 돌린 명령 → 결과 / 못 돌린 것 → 이유
- 주장 근거: <body 에 쓴 정량·전칭 주장> — <그것을 만든 명령> → <출력 요약> (주장마다 한 줄)
- 남은 위험: 없으면 "없음"
```

서사 없이 위 항목만. 출처: `memory/workflow/implementation/memory.md` §1.

`주장 근거` 는 `검증` 과 세는 축이 다르다 — `검증` 은 돌린 명령을 세고, 이쪽은
body 에 남은 주장을 센다. 그래서 body 를 다 쓴 뒤 한 줄씩 되짚어야 채워진다.
구분자가 `|` 가 아닌 이유는 명령 자리가 파이프를 낄 수 있어서다. 명령 자리가 빈
주장은 body 에 두지 않고, 뺐다는 사실을 그 줄에 적는다. 쓸 주장이 하나도 없으면 "없음". 제약 본문은 여기 없다 —
`memory/workflow/implementation/memory.md` §5 「수치가 추론으로 생산됨」 ·
「새로 쓴 전칭 서술이 실측을 넘어섬」 이 SOT 다.
