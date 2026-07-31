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

- `memory/workflow/implementation/memory.md` — §5 착수 전 체크리스트가 이 역할의
  핵심이다. 리뷰어가 요구하기 전에 저자가 통과시킨다.
- `memory/workflow/delivery/memory.md` — 커밋~PR 구간 행동 계약 · 중단 조건 ·
  PR body 제약.
- `memory/workflow/git-policy/memory.md` — hard block 목록과 push reject 회복.
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
   출처: `memory/workflow/git-policy/memory.md` 「SHA refspec push 패턴」.
5. PR 생성 (base main, 본문에 `Closes #<이슈>`). 수치 주장에는 그것을 만든
   명령을 붙인다. PR body 의 경로는 GitHub 에서 열리는 것만 쓴다 — 금지 패턴과
   해소 방법은 `memory/workflow/delivery/memory.md` 「PR body」.
6. 보고하고 종료한다. CI 를 기다리지 않고, 다음 노드를 부르지 않는다.
   리뷰 부착은 orchestrator 가 label 을 보고 한다.

수정 라운드도 같은 사본, 같은 브랜치에서 이 절차를 다시 밟는다.

## 중단 조건

`needs:user` label · GPG/push 이상 · 사용자 명시 거부 · 라운드 회고 트리거.
라운드가 3 이상이면 같은 유형에 fix 를 더 쌓지 말고 상태를 보고하고 종료한다 —
판정은 회고 모드 리뷰어 몫이다.
출처: `memory/workflow/delivery/memory.md` 「자율 실행 vs 중단」.

## 반환 형식

```
- 변경 파일: <path> (한 줄씩)
- 커밋: <sha> <제목>
- push: <ls-remote 로 대조한 원격 SHA>
- PR: #<번호>
- 검증: 돌린 명령 → 결과 / 못 돌린 것 → 이유
- 남은 위험: 없으면 "없음"
```

서사 없이 위 항목만. 출처: `memory/workflow/implementation/memory.md` §1.
