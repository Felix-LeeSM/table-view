---
title: Orchestration — 병렬 작업 spawn · 리뷰 큐 · 사이클 정지
type: workflow-rule
updated: 2026-08-16
task: orchestration, parallel-pr, spawn, review-queue, cycle-detection, issue-authoring
keywords: spawn, slot, slot 상한, 동시 활성, 병렬, 파일 교집합, 리뷰 큐, 수용 기준, 접수 조건, 사이클, needs:user, 이슈 발행, 유형 단위, raw, task, 보고 검증, 도달 검증, 세션 스냅샷, 묶음 이슈, 해악별 값, 겸무, 정지 조건, 사용자 산문, 고정부 첨부, origin/main 판, 머지 칸, 대기 칸, 머지 보고, 종결자 반환, 위임 모드, non-blocking 스윕, gh pr list --state merged
trigger:
  signal: 여러 작업을 동시에 돌리거나, 이슈를 발행하거나, 리뷰 라운드가 안 끝날 때
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# Orchestration

Orchestrator 의 행동 계약 — **이 계약을 지는 주체는 이렇다.** interface 가
`.agents/prompts/orchestrator.md` 파일 그대로 spawn 하는 subagent, 그리고
orchestration 을 직접 겸무하는 interface 세션. 겸무의 허용 여부 · 조건 ·
겸무해도 유지되는 규율은 [interface](../interface/memory.md) §3 이 SOT 이고 여기
옮겨 적지 않는다. 개별 작업 방법의 SOT 는 없고, 이
방은 **작업 사이의 결정** 만 둔다 — 무엇을 언제 spawn 하는가, 리뷰를 어떤 순서로
붙이는가, 언제 멈추는가.

**입력은 task 티켓과 label 뿐이다.** 사용자 산문은 접수하지 않는다 — 설계·범위
발화가 오면 [interface](../interface/memory.md) 가 티켓으로 만들어야 한다.
**금지하는 것은 사용자 산문이 승격 절차 없이 스케줄링에 직행하는 것이지 대화
자체가 아니다.** spawn 된 노드는 사용자와 이어진 채널이 없어 이 금지가 곧
"멈추고 돌려보내라" 다. 겸무 세션은 대화하면서도 [interface](../interface/memory.md)
§1(반대 근거) · §2(승격)를 지나 나온 티켓과 label 만 이 방의 입력으로 쓴다 — 그
절차를 건너뛴 발화는 겸무 세션에서도 스케줄링 입력이 아니다.

## 1. 파일 범위는 착수 전에 티켓이 갖는다

티켓을 쓰는 쪽이 착수 전에 전수 명령을 **실제로 돌려서** 티켓에 파일 범위를
박는다. 그 출력이 곧 범위다 — 범위를 예측으로 채우지 않는다.

**전수 명령의 도구는 `git grep` 이다.** 기본 `rg` 는 전수가 아니다 — 루트
`.ignore` 가 `docs/{archives,explorations}` 를 빼고, dotfile 기본 제외가
`.agents/` · `.claude/` · `.github/` 등 dot 경로를 뺀다. `rg` 로 같은 모집단을
세려면 `--no-ignore-dot --hidden` 이 둘 다 필요하다. 제외 목록과 rg 레시피는
[docs/README.md](../../../docs/README.md) 「검색 팁」이 SOT 다.

그래서 spawn 전에 티켓의 파일 범위로 겹침을 재고, PR 이 열린 뒤에는 사실로 다시
대조한다.

    gh pr view <N> --json files -q '.files[].path'

필요한 것은 **겹치는 쌍과 순서**뿐이고 파일 목록 자체는 아니다. 목록을 걸러서
돌려주던 script 는 없어졌고 대체물도 없다 (§2).

**Why**: 2026-07-25 동시 in-flight 8건에서 28쌍 중 18쌍이 파일 교집합을 가졌고,
`docs/contributor-guide/testing-and-quality.md` 하나를 5개 PR 이 동시 수정했다
(`docs/ROADMAP.md` 4개, `docs/product/known-limitations.md` 3개). 겹침은 예외가
아니라 기본값이라 재지 않으면 리뷰 한 라운드가 통째로 버려진다.

## 2. 동시 slot 상한 · 작업은 병렬로, 리뷰를 직렬화한다

**동시 활성 노드 총합 ≤ 5. 리뷰어도 차감한다.** 재개 메시지에 `상한: N` 지시자가
오면 그 값을 쓴다 — [interface](../interface/memory.md) §3 이 그것을 interface 가
보낼 수 있는 유일한 비포인터 입력으로 정한다. **상한값이 방에 있어야 고정부를 안
받는 겸무 세션에 닿는다** — `.agents/prompts/orchestrator.md` 는 이 값을 스스로 갖지
않고 여기를 가리킨다.

충돌 비용은 작업이 아니라 리뷰다. 겹침이 있으면 작업을 막는 게 아니라 **리뷰 큐
순서** 를 준다. 판단이 0 인 계산이라 원래 script 가 맡던 자리인데, 지금은 그
script 도 대체물도 없다.

- 교집합이 있는 PR 은 큐 뒤로. 앞 PR merge 후 `git merge` 로 최신 base 를 들인 뒤
  리뷰한다 (rebase 는 force-push 가 필요해 금지 — [git-policy](../git-policy/memory.md)).
- 큐 순서는 충돌 표면이 작은 것부터.
- 뒤 PR 은 항상 최신 base 에서 리뷰되므로 충돌 finding 이 구조적으로 안 생긴다.

## 3. 사이클이면 멈추고 사용자에게 올린다

판정 주체는 회고 모드 리뷰어다 — 라운드 3부터는 개별 지적이 아니라 같은
유형의 반복을 본다. 저자도 orchestrator 도 여기서 판정하지 않는다.
트리거는 둘 중 하나다 — **라운드 k 에 없던 blocking 이 k+1 에 생겼거나**,
**k+1 에도 blocking 이 있는데 k 의 것이 하나도 안 없어졌을 때.** 둘 다
blocking 0 인 재리뷰는 어느 쪽도 안 걸려 트리거가 아니다 — 집합 낱말로 쓰면
여기가 뒤집힌다 (공집합은 자기 자신의 진부분집합이 아니다 — PR #2405 라운드 3).

1. 해당 PR 리뷰 중단.
2. 파일 교집합이 있는 in-flight PR 을 리뷰 큐에서 함께 정지 (작업은 그대로).
3. [interface](../interface/memory.md) 를 거쳐 사용자에게 올리고
   대기한다(`needs:user`). **orchestrator 는 판단하지 않는다.**

보고에 담을 것: 라운드별 blocking 집합 변화 / 재발한 유형과 라운드별 건수 /
저자가 시도한 것 / 함께 정지된 PR 과 공유 파일 / 선택지(범위 축소·근본
분리·닫고 재설계).

**Why**: 사이클 지점은 정의상 자동 판단이 이미 실패한 곳이다. 저자가 잡은 근본이
다음 라운드에 재발 판정을 받은 실제 사례가 있으므로, 저자나 orchestrator 가 "무엇이
근본인가" 를 자동 판정하면 같은 실패를 조용히 반복한다.

## 4. 이슈는 확대해석의 여지가 없어야 한다

티켓을 쓰는 주체가 이 절을 기준으로 삼는다. 이슈 본문의
배경·근본원인·표는 상세해도 좋다. **닫혀야 하는 것은 수용 기준이다.**

- 완료 조건은 **명령 출력 하나**다. 여러 개면 이슈를 나눈다.
- **적히지 않은 것은 범위 밖이다.** 구현자도 리뷰어도 넓힐 수 없다.
- "~별로 판정" 같은 재량 항목은 판정 기준을 이슈에 박거나, 그 판단 자체를 별도
  조사 이슈로 뺀다.
- 유형 단위로 연다. 한 유형에 10건이 걸려도 이슈는 10개가 아니라 1개다.
- 처방 하나가 해악 여럿을 겨냥하는 묶음이면 **해악별로 값을 갈라 적는다** — 값이
  자릿수로 다르고, 그 처방으로는 안 고쳐지는 해악이 섞여 있던 사례가 있다.

전수 명령의 hit 수가 곧 작업 크기다 — 예측 없이 착수 전에 알 수 있다.

**이 절은 orchestrator 의 접수 조건이다.** 못 채운 이슈는 `task` 가 아니라
`raw` 다. raw → task 승격은 [interface](../interface/memory.md) 전담 — 어떤
노드도 `task` 를 직접 발행하지 않는다.

**Why**: 상세함과 닫힘은 다르다. 수용 기준 5개가 전부 "전 target 열거 / 전수 조사
/ target 별로 판정" 이던 이슈가 낳은 PR 은 5라운드 끝에 닫혔다. 열린 집합 주장은
반증만 되고 검증은 안 된다 — 종료 조건이 없다.

## 5. 이슈 1개 ≠ PR 1개

명세 작성자가 착수 시점에 변경 기준을 잡고 작업을 자른다. 이슈가 크면 PR 을
나눈다 — 리뷰가 쪼개라고 말하는 건 이미 라운드를 태운 뒤라 늦다.

## 6. 상충

- **파일 충돌** — §1·§2 로 처리. 연속 번호 배치 이슈는 실행 순서를 이슈에 명시한다.
- **결정 상충** — 파일이 안 겹쳐도 발생하고 구현 후에야 드러난다. 사후 탐지에
  맡긴다(§3 트리거). 열린 이슈 전부를 ADR 로 승격시키는 건 현재 자원 밖이다.

## 7. 도달은 spawn 하는 쪽이 책임진다

노드가 memory 를 스스로 읽으러 오리라 기대하지 않는다 — 안 읽는 것이 실측이다.
그래서 고정부를 파일로 두고 **spawn 하는 쪽이 그대로 첨부**한다: 역할 preamble
`.agents/prompts/<role>.md` (Claude Code 네이티브 spawn 은 `.claude/agents/<role>.md`
정의가 그 파일을 첫 행동으로 읽는다). preamble 은 MANDATORY 첫 명령(사본 경로
검증)과 착수 전 MANDATORY read 목록을 싣고, **계약 본문은 복제하지 않는다** —
읽는 것이 노드의 첫 행동이다. spawn 메시지는 가변부만 싣는다. 형식은
`.agents/prompts/orchestrator.md` 의 "Spawn 규칙".

**첨부할 고정부는 `origin/main` 의 판이어야 한다.** 밀린 트리에서 읽으면 옛 계약이
그대로 노드에 실린다 — `.agents/prompts/pr-finalize.md` 의 3단계 명령이 통째로 옛
판이던 것이 실측이다(#2284). Claude Code 네이티브 spawn 은 `.claude/agents/<role>.md`
정의가 경로를 `git show origin/main:` 으로 고정해 읽어 이 해악을 스스로 피하지만,
**손으로 첨부하는 쪽에는 그 장치가 없다** — 겸무 세션이 그 자리다. 트리를
`origin/main` 에 맞춘 뒤 읽거나 `git show origin/main:<path>` 로 읽는다. 갱신 명령과
그 블록이 재지 **않는** 것은 `.agents/prompts/orchestrator.md` 「첫 명령」이 갖는다.

**나가는 프롬프트만이 아니라 돌아오는 보고도 spawn 한 쪽 책임이다.** subagent 의
보고를 다음 노드의 전제로 넣기 전에 검증한다 — 모호한 문장을 그대로 넘기면 뜻이
뒤집힌 채 전파된다 (2026-07-25 실측). 인용은 원문 그대로 하고 해석은 검증 뒤에 붙인다.

그 책임은 **위로 올리는 것까지다.** 종결자 반환의 첫 줄
(`.agents/prompts/pr-finalize.md` 「반환 형식」의
`- PR: #<번호> — merged <머지 SHA> (squash)`)이
[interface](../interface/memory.md) §2 non-blocking 스윕의 트리거인데, 위임 모드에서
그 반환은 orchestrator 가 받고 interface 는 못 본다 — 보고로 안 올리면 그 PR 의
non-blocking 은 아무 데도 안 간다. 올리는 것은 **번호와 머지 SHA 를 원문 그대로**이고
거기까지다: 코멘트를 열지 않고 무엇을 이슈로 열지도 정하지 않는다 — 그 판단은 §4 를
지나는 interface 몫이다. 값의 출처를 `gh pr list --state merged` 로 바꾸지 않는다.
창을 정의해야 하고, 그 창은 남의 세션이 머지한 PR 과 앞 pass 가 이미 올린 PR 을 다시
실어 같은 스윕을 두 번 발화시킨다. 반환 전에 pass 가 끝난 PR 은 머지 칸이 아니라
`대기` 로 가고 다음 pass 의 머지 칸이 집는다. 칸의 형식은
`.agents/prompts/orchestrator.md` 「보고 형식」.

**`대기` 칸은 이 pass 가 행동을 안 끝낸 이슈·PR 번호를 담는다** — spawn · 머지 · 정지
어느 칸에도 안 들어간 자리다. 위의 「반환 전에 pass 가 끝난 PR」이 그리로 온다. 집는
것은 다음 pass 인데 **교체되면 그 pass 가 없다** — 그때의 행선지는
[interface](../interface/memory.md) §3 이 갖는다.

**도달 검증에는 세션 경계가 있다.** `CLAUDE.md` 의 `@` import 와 harness 의 agent
정의 레지스트리는 **세션 시작 시점 스냅샷**이다 — 이 파일들을 바꾸는 PR 의 도달
검증은 머지 뒤 **새 세션**에서만 유효하다. 같은 세션에서 띄운 probe 가 옛 문장을
인용하는 것은 실패 증거가 아니라 스냅샷 증거다 (2026-08-01 실측).

## 8. 정지 조건 — spawn 을 멈추고 보고한다

아래 중 하나면 노드를 더 띄우지 말고 상태 표와 이유를 보고하고 멈춘다. 판단해서
넘기지 않는다. **겸무 세션도 같다** — 멈추는 것은 스케줄링이고 사용자 대화는
[interface](../interface/memory.md) 계약으로 이어 간다.

- `needs:user` 가 붙은 이슈/PR 발견 (§3 사이클 정지가 그 label 을 붙인다).
- 첨부할 고정부를 `origin/main` 판으로 읽을 수 없음 (§7).
- GPG · push 이상. [git-policy](../git-policy/memory.md) hard block 을 우회하지
  않는다 — **force / reset 으로 primary 를 밀지 않는다.**
- 같은 노드 중복 활성 의심. 사망 미확인 respawn 금지
  ([worktree](../../runbook/worktree/memory.md) 「점유」).
- slot 계산 불가.

명령 시퀀스와 그 시퀀스가 만드는 ABORT 자리는 `.agents/prompts/orchestrator.md`
「첫 명령」·「정지 조건」이 갖는다 — 무엇이 계약이고 무엇이 절차인지의 판정은
[runbook](../../runbook/memory.md) 「계약 / 절차 경계」다.

## 관련

- [interface](../interface/memory.md) — 사용자 대화·티켓 승격·orchestrator 운용
- [review](../review/memory.md) — reviewer 행동 계약
- [delivery](../delivery/memory.md) — 커밋 → 푸시 → PR → 리뷰 → 머지 구간의 node 별 계약
- [git-policy](../git-policy/memory.md) — force-push 금지, rebase 대신 merge
- [worktree](../../runbook/worktree/memory.md) — 작업 사본(clone) 생성·점유·회수
- [pr-merge-gates](../../runbook/pr-merge-gates/memory.md) — required context 목록과 게이트 계약
- [diagnosing-merge-gates](../../../.agents/skills/diagnosing-merge-gates/SKILL.md) — merge 게이트 진단 순서
