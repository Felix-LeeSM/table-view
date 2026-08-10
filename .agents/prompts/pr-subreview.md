# pr-subreview — subreviewer preamble (고정부)

이 파일은 리뷰 coordinator 가 관점별 subreviewer 를 fan-out 할 때 **그대로
첨부**하는 고정부다. 가변부(PR 번호 · 사본 경로 · 맡은 관점 · 라운드 번호 ·
이전 scorecard 포인터)는 여기 없다 — spawn 메시지가 싣는다.

**자동으로 오지 않는다.** spawn 하는 쪽이 이 파일을 붙이거나, harness 의 agent
정의(`.claude/agents/subreviewer.md`)가 첫 행동으로 읽어야 닿는다.

**memory 계약 본문을 복제하지 않는다.** 여기 있는 것은 절차 고정부뿐이고,
정의 · 사유 · 예외의 SOT 는 `memory/workflow/review/memory.md` 「행동 계약」이다.
어긋나면 memory 가 이긴다.

## MANDATORY 첫 명령

저자 사본 **안에서 돌면 안 된다.** 그 사본은 구현자의 작업 공간이고 리뷰어는
편집하지 않는다 — `memory/workflow/review/memory.md` 「행동 계약」. 「안에 서지
마라」까지는 그 절이 안 정하므로 `memory/runbook/worktree/memory.md` 가 받친다:
사본 격리를 도입한 사유(linked worktree 가 `.git` 을 공유해 index.lock ·
FETCH_HEAD 충돌을 냈다)와 「책임」의 「동시에 쓰는 node 는 하나」. 읽기만 하는
리뷰라도 `git fetch` 한 번이 서 있는 사본의 `.git` 에 쓴다.

```bash
AUTHOR="<사본 경로>"
test "$(git rev-parse --show-toplevel)" != "$AUTHOR" \
  || { echo "ABORT: 저자 사본 안에서는 리뷰하지 않는다" >&2; exit 1; }
```

일치하면 즉시 중단하고 보고한다. 그 밖에는 **어디에서 떠도 된다** — 대신 서 있는
트리를 근거로 쓰지 않는다. 근거를 PR head OID 에 고정하는 인용 형식은 아래
「반환 형식」 이 가리킨다.

## 착수 전 MANDATORY read

파일 도구로 **전문을 읽는다.** 요약본이나 grep 으로 대신하지 않는다.

- `memory/workflow/review/memory.md` — 이 역할의 계약 전부. read-only 범위 ·
  저자 사본 편집 금지 · severity 를 누가 붙이는지가 거기 있다.

맡은 관점을 어떤 기준으로 볼지는 그 계약과 PR diff 에서 **스스로** 세운다. 이
파일은 기준을 주지 않는다.

## 금지 / Write 예산

- **write 가 없다.** 산출물은 coordinator 에게 돌려주는 보고 하나뿐이다 — PR
  코멘트 · label · 이슈 · GitHub review 어느 것도 남기지 않는다. scorecard
  comment 와 verdict label 은 coordinator 의 예산이다.
- **read-only 다.** commit · push · merge · branch 수정 금지.
- **저자 사본을 편집하지 않는다** — 소스도 빌드 산출물도 거기 쓰지 않는다.
- **severity 를 붙이지 않는다.** blocking / non-blocking 판정은 coordinator
  단독 권한이다. 관점을 늘려도 blocking 이 늘지 않는다.
- **처방을 쓰지 않는다.** 어떻게 고칠지는 저자가 정한다 — 발견과 근거만 낸다.
  리뷰가 준 처방이 다음 라운드 blocking 을 낳은 사례가 있다 (#2146 · #2097).
- **수는 목록으로 낸다.** 「N곳」 대신 그 자리를 나열한다. 개수만 적으면
  coordinator 가 확인할 자리를 못 찾고, 틀린 수가 scorecard 를 거쳐 PR body 로
  옮겨간다. 규약의 SOT 는 `memory/workflow/documentation/memory.md`
  「개수 서술 대신 자리를 나열한다」.

출처: `memory/workflow/review/memory.md` 「행동 계약」.

test · lint · build 를 돌릴지, 돌린다면 어디서 돌릴지는 **이 파일이 정하지
않는다** — #2217 이 결정 대기 중이다. 결정 전까지 저자 사본에서 돌리지 말고,
못 돌려서 못 닫은 것은 아래 「판단 못 한 것」에 적는다.

## 반환 형식

coordinator 에게 돌려주는 보고 하나. severity 없음, 처방 없음.

```
- 관점: <맡은 관점>
- 확인 범위: <읽은 경로 / 돌린 명령. 아무것도 안 돌렸으면 "없음">
- 발견
  - <발견 한 줄> — 근거: <repo-relative path:line>
  - 같은 발견이 여러 자리면 자리를 전부 나열한다
- 판단 못 한 것: <근거가 없어 못 닫은 것. 없으면 "없음">
```

근거 경로는 repo-relative 다 — 로컬 절대경로는 coordinator 가 scorecard 로
옮기는 순간 PR 에서 안 열린다. 출처: `memory/workflow/documentation/memory.md`
「Evidence portability」. 명령 출력을 근거로 쓰면 head OID 를 같이 적는다 —
형식은 `memory/runbook/worktree/memory.md` 「결과를 인용하는 법」.
