---
title: Documentation Impact Gate
type: workflow-rule
updated: 2026-08-11
task: documentation, docs, pr, review, delivery
keywords: 문서화, documentation impact, 문서화 impact 게이트, Reviewer 판정, SOT 라우팅, evidence portability, repo-relative, retire 조건, 개수 서술, 닫힌 개수, 자리 나열, scorecard 수치, 가변 상태, 조회 명령, 움직이는 ref, head SHA, 현재형 단정, 옮겨 적은 값, 앵커, 종점, merge-base
trigger:
  signal: PR 작성 / 문서 추가 / workflow·contract·user-facing 변경
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# Documentation Impact Gate

모든 PR 은 "문서가 필요한가?" 와 "기존 SOT 어디에 반영했나?" 를 먼저
판단한다. 새 문서 생성은 마지막 선택지이며, 기존 체계 우회 금지.

## Documentation impact 판단

PR body 형식 요구는 없다. 아래 질문에 스스로 답하고, 답을 남길 곳은
PR body / 커밋 메시지 / 리뷰 코멘트 중 아무 곳이나 고른다.

- 문서화가 필요한가 (아래 트리거 목록).
- 필요하면 기존 SOT 중 어디를 갱신했나 (repo-relative path).
- 불필요하다면 왜인가 — "작아서" 가 아니라 "test-only, public behavior 0"
  처럼 트리거가 없음을 짚는다.

## 문서화 필요 트리거

- 사용자 가시 동작 변경: UI flow, shortcut, warning/confirm, default 값.
- contract 변경: IPC payload, store/hook API, enum, SQL kind/severity.
- workflow/rule 변경: agent, review, delivery, git 정책.
- safety/security 변경: password, signing, destructive command, safe mode.
- 운영/검증 변경: CI, test strategy, coverage threshold.
- architecture/invariant 변경: 앞으로 지켜야 할 설계 제약.
- deferred risk/follow-up 발생: 지금 안 고치는 이유와 추적 위치 필요.

## 기존 SOT 라우팅

| 내용 | SOT |
|---|---|
| sequencing / 다음 sprint 후보 | `docs/ROADMAP.md` |
| 반복 적용 규칙 / workflow / product / engineering | `memory/**/memory.md` |
| 현재 사용자-visible 제한 | `docs/product/**` — per-source 행은 `known-limitations-{rdbms,non-rdbms,cross-cutting}.md` |
| 미래 follow-up | `docs/roadmap/follow-up-queue.md` |
| 승격 후보 순서 | `docs/ROADMAP.md` |
| 구조적 제약 | `memory/engineering/architecture/**` |
| 개발/운영 검증 제약 | `memory/engineering/**` 또는 `docs/contributor-guide/**` |
| 과거 risk register / 사건 | `docs/archives/**` |
| 임시 audit 원문 | 사용자 명시 승인 + retire 조건 필수 |

임시 `docs/<new-area>/` 는 SOT 가 아니다. 만들기 전 PR body 에 owner SOT,
retire 조건, 흡수 계획을 적고 사용자 승인을 받는다.

## Evidence portability

PR body / review comment / handoff 는 GitHub 에서 확인 가능한 증거만 사용:

- 허용: repo-relative `path:line`, GitHub PR/commit/check URL.
- 금지: `/Users/...`, `/tmp/...`, `file://...`, `worktrees/...`, `clones/...`,
  로컬 plan path.
- 로컬 임시 로그는 요약을 붙이고, 재현 명령 또는 repo artifact 로 대체.

## 개수 서술 대신 자리를 나열한다

「N개뿐」·「넷이다」·「둘 다」 같은 닫힌 개수 서술은 그것이 세는 목록이 늘거나
줄면 그 자리에서 거짓이 된다. **수를 쓰지 않으면 잘못 셀 수가 없다** — 개수
대신 자리를 나열한다.

**저장소 산문을 쓰는 자리면 걸린다 — 특정 역할의 목록이 아니다.** 저자의 PR
body · 커밋 메시지 · 소스 주석, 리뷰어의 scorecard · 리뷰 코멘트, 티켓 저자의
이슈 본문, 종결자의 squash body 가 그 자리다. 역할이 늘면 자리도 는다 — 이
규약을 낳은 #2229 자신이 「범위」를 「두 파일.」로 열고 같은 파일만 나열했고,
PR #2232 의 squash body 를 이 규약에 맞게 고친 것은 저자도 리뷰어도 아닌
종결자였다. scorecard 의 수는 다음 라운드 저자의 입력이라, 리뷰어가 잘못 센
수를 저자가 body 로 옮기고 다음 라운드가 그것을 blocking 으로 잡는다
(PR #2218 — 라운드 2 scorecard 가 그 수의 출처를 라운드 1 scorecard 로 밝혔다).

```
❌ 승격 claim 이 5곳에 남아 있다.

✅ 남은 자리:
   - src/lib/a.ts:12
   - src/lib/b.ts:44
```

목록은 줄마다 대조되고, 빠진 자리가 있어도 틀린 수가 아니라 참인 부분집합이다.
옮겨 적을 수가 애초에 안 생긴다. 수 자체가 결론이면 그것을 만든 명령을 붙인다 —
[implementation](../implementation/memory.md) §5 「수치가 추론으로 생산됨」이 SOT 다.

## 가변 상태는 값이 아니라 조회 명령으로 쓴다

**판정은 물음 둘이다 — ① 그 문장의 값이 내 diff 안에서 나오나, 다른 산출물을
열어야 나오나. ② 열어야 나온다면 그 값이 앵커에 걸려 있나.** 열어야 나오는데
앵커가 없으면 **가변 상태**다. 그것을 움직이는 쪽이 내가 아니므로, 값을 산문에
박는 순간 남의 다음 행동이 내 문장을 거짓으로 만든다. **내가 안 만든 값은 내가
못 지킨다 — 값을 쓰지 말고 그 값을 낸 명령을 쓴다.** 위 「개수 서술」이 이
규칙의 한 사례다: 개수는 열어 봐야 아는 가변 상태 중 세어서 얻는 것이고, 이 절은
같은 처방을 상태 일반으로 넓힌다.

**판정 단위는 문장이 아니라 절이다.** 한 문장이 종점 사실과 가변 상태를 접속사로
잇는 것이 흔하고, 그때 고칠 것은 가변인 절뿐이다 — 아래 ❌ 가 그 형태다.

가변 상태는 최소한 이것들이다:

- 다른 PR · 이슈가 지금 `open` 인가, 그리고 닫힌 것이 다시 열렸나. **`merged` 는
  종점이라 안 움직인다**
- 움직이는 ref(`origin/main` · 브랜치 이름)의 **head SHA**, 그리고 **앵커 없이**
  그것으로 잰 분기점 · diff 수치
- 「지금 …이다」 · 「열린 …」 · 「아직 …가 잡고 있다」 류의 **현재형 단정**
- 다른 노드의 산출물(scorecard · 앞 라운드 body · spawn 프롬프트)에서 **옮겨 적은 값**
  — 커밋 SHA · 분기점 · 줄 번호 · 개수. 옮길 때 그 값을 낸 명령을 같이 옮긴다

**앵커**는 나중에 다시 열어도 같은 값을 내는 지점이다. 앵커에 걸린 값은 해당 없다:

- rev 를 박은 조회 — `git show <rev>:<path>` · `git grep <rev>`
- 브랜치가 갈린 지점 `"$(git merge-base origin/main HEAD)"` — diff 계열의 **처방**이
  거기 있다 ([delivery](../delivery/memory.md) 「PR body」). 같은 diff 를
  `origin/main` 에 대고 재면 앵커가 없어 위 목록 2번째로 걸린다
- **머지된** PR 의 필드 — `mergeCommit` · `base.sha`. 그 PR 은 더 안 움직인다
  (`gh api repos/<owner>/<repo>/pulls/<N> --jq '.merged, .base.sha'`)

**「그 자리에서 돌렸다」는 앵커가 아니다.** 판정자는 돌렸는지 볼 수 없고, 같은
명령이 나중에 다른 값을 내면 그 출력은 이미 낡았다. 앵커 없는 출력을 인용해야 하면
어느 커밋에서 나왔는지를 같이 적는다 —
[worktree](../../runbook/worktree/memory.md) 「결과를 인용하는 법」이 그 형태를 갖는다.

```
❌ #2259 는 3c16b24c 로 머지됐고 그 커밋이 지금의 origin/main head 다.
   앞 절은 종점이다 — 머지는 되돌아가지 않는다. 가변인 것은 뒤 절뿐이다.

✅ #2259 의 머지 커밋은 3c16b24c 다 (gh pr view 2259 --json mergeCommit).
   그 커밋이 지금 origin/main head 인지는 읽는 시점마다 다르다 — 안 쓴다.
```

값이 아니라 명령이 남으면 읽는 노드가 스스로 돌려 그 시점의 값을 얻는다. 옮겨
적힌 값이 다음 라운드의 거짓 전제가 되는 사슬은 그 자리에서 끊긴다.

## Reviewer 판정

[review](../review/memory.md) 「행동 계약」의 문서화 impact 게이트 사유가 이 절을
가리킨다 — blocking 사유 목록은 그 방이 갖고, 여기는 그 사유의 상세만 둔다.

리뷰어는 다음을 blocking finding 으로 본다. 판정하는 것은 **내용**이고,
body 에 어떤 섹션이 있는지는 판정 대상이 아니다:

- 문서화 트리거가 있는데 어떤 SOT 도 갱신되지 않음.
- 기존 SOT 대신 새 backlog/plan 디렉토리를 만들고 retire 조건 없음.
- workflow/rule 변경인데 `memory/workflow/**` 갱신 없음.
- PR 에서 볼 수 없는 로컬 절대경로를 근거로 사용. 이 줄만 겨냥된 required check
  를 갖는다 — `.github/workflows/ci.yml` 의
  `Reject non-portable paths in PR body` step 이다. **그 step 이 실제로 red 면 그
  건은 review 방의 자동 layer 실패 사유로도 걸린다.** 다만 step 이 이 줄을
  대신하지는 않는다: 덮는 것은 PR body 한 채널 · 그 파일에 박힌 리터럴 목록 ·
  커밋이 올 때 한 시점이라, 위 「Evidence portability」가 금지하는 나머지(리뷰
  코멘트 · handoff · 그 목록 밖 경로 형태 · 마지막 커밋 뒤 body 편집 · 빈 body)는
  기계 밖이고 이 게이트가 판정한다.

어느 줄이든 트리거가 발생했는지는 사람이 읽어야 판정된다 — 그래서 이 게이트가
별도 사유로 선다.

## 관련

- [delivery](../delivery/memory.md) — commit → push → PR 행동 계약
- [review](../review/memory.md) — documentation topology 평가
- [git-policy](../git-policy/memory.md) — 검증 우회 / signing safety
