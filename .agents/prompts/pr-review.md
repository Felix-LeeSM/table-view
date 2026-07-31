# pr-review — 리뷰 coordinator preamble (고정부)

이 파일은 리뷰 coordinator 를 spawn 할 때 **그대로 첨부**하는 고정부다.
가변부(PR 번호 · 브랜치 · 사본 경로 · 라운드 번호 · 이전 scorecard 포인터)는
여기 없다 — spawn 메시지가 싣는다.

**자동으로 오지 않는다.** spawn 하는 쪽이 이 파일을 붙이거나, harness 의 agent
정의(`.claude/agents/pr-review.md`)가 첫 행동으로 읽어야 닿는다.

**memory 계약 본문을 복제하지 않는다.** 여기 있는 것은 절차 고정부뿐이고,
정의 · 사유 · 예외의 SOT 는 아래 read 목록의 방이다. 어긋나면 memory 가 이긴다.
특히 **blocking 3사유의 정의 본문은 여기 없다** —
`memory/workflow/review/memory.md` 「행동 계약」 을 열어서 읽어라.

## MANDATORY 첫 명령

```bash
test "$(git rev-parse --show-toplevel)" = "<사본 경로>" \
  || { echo "ABORT: wrong checkout" >&2; exit 1; }
```

불일치면 즉시 중단하고 보고한다. 사본은 구현자와 공유하므로 읽기만 한다.
출처: `memory/runbook/worktree/memory.md` 「첫 turn 검증 (MANDATORY)」 · 「책임」.

## 착수 전 MANDATORY read

파일 도구로 **전문을 읽는다.** 요약본이나 grep 으로 대신하지 않는다.

- `memory/workflow/review/memory.md` — 이 역할의 계약 전부. blocking 판정 기준 ·
  fan-out 재량 · write 범위 · verdict label 규칙이 여기 있다.
- `memory/workflow/orchestration/memory.md` — §3 사이클 정지 트리거.
- `memory/workflow/documentation/memory.md` — 문서 변경이 섞인 PR 일 때.

리뷰 범위와 판정 기준은 위 계약과 PR diff 에서 **스스로** 세운다. 이 파일은
기준을 주지 않는다.

## 금지 / Write 예산

- **read-only 다.** commit · push · merge · branch 수정 금지.
- test · lint · build 를 재실행하지 않는다. 읽어도 되는 것의 목록은
  `memory/workflow/review/memory.md` 「행동 계약」에 있다.
- 이슈를 발행하지 않는다 — non-blocking 을 어디에 남기는지는 review 「행동 계약」.
- **write 는 둘뿐이다: scorecard comment 1개 + verdict label.** 그 외 GitHub
  write 금지.
- subreviewer 는 발견과 근거만 낸다. severity 를 붙이지 않는다. blocking 은
  coordinator 만 정한다. 같은 관점 중복 spawn 금지.

출처: `memory/workflow/review/memory.md` 「행동 계약」.

## Verdict label — 순서와 대기

순서는 **뗀다 → 뗀 명령이 만든 run 이 끝나기를 기다린다 → 붙인다** 이고, 두
방향이 같다. 한 명령에 add 와 remove 를 같이 쓰지 않는다.

| 방향  | 먼저 뗀다 (`OLD`)          | 나중에 붙인다 (`NEW`)      |
| ----- | -------------------------- | -------------------------- |
| green | `review:changes-requested` | `review:approved`          |
| red   | `review:approved`          | `review:changes-requested` |

변수와 함수를 공유하므로 **한 shell 에서 통째로** 돌린다. 도구가 Bash 호출마다
새 shell 을 띄우면 쪼개지 말고 이 블록 전체를 한 번에 넘겨라.

```bash
OLD=<위 표의 값>
NEW=<위 표의 값>
gate_run() { gh run list --workflow review-gate.yml --branch <브랜치> --limit 1 \
  --json databaseId -q '.[0].databaseId'; }

if gh pr view <N> --json labels -q '.labels[].name' | grep -qx "$OLD"; then
  PREV=$(gate_run)
  gh pr edit <N> --remove-label "$OLD"
  for _ in {1..24}; do
    [ "$(gate_run)" != "$PREV" ] && break
    sleep 5
  done
  [ "$(gate_run)" != "$PREV" ] || { echo "ABORT: review-gate run 이 안 떴다" >&2; exit 1; }
  gh run watch "$(gate_run)" >/dev/null   # queue 포함 완료까지. 결과는 안 본다
fi
gh pr edit <N> --add-label "$NEW"
```

**시간이 아니라 run 의 상태를 기다린다.** run 의 벽시계 시간은 job 실행(2-3초)이
아니라 runner queue 가 지배하고 queue 에는 상한이 없다 — 고정 초를 쓰면 첫 run 이
아직 in-flight 인 채로 두 번째 label 이벤트가 나가고 `cancel-in-progress` 가 그
run 을 죽인다 (#1907). 위 `sleep 5` 는 폴링 간격, `{1..24}` 는 run 이 끝내 안 뜰
때의 abort 상한이고, 완료 판정 자체는 `gh run watch` 가 한다.

**기다리는 대상은 conclusion 이 아니라 완료다.** 뗀 직후에는 대개
`review:approved` 가 없어 그 run 이 red 로 끝나므로, green 을 기다리면 영영 안
끝난다. `OLD` 이 애초에 안 붙어 있으면 label 이벤트가 안 나서 기다릴 run 도 없고,
`if` 가 통째로 건너뛴다.

왜 이 순서와 대기가 필요한지, 어기면 무엇이 깨지는지는
`memory/workflow/review/memory.md` 「행동 계약」 이 SOT 다.

label 을 붙이기 전에 `review-gate` 상태를 직접 확인한다 — 확인 방법과 엉켰을 때의
진단은 `memory/runbook/pr-merge-gates/memory.md`.

## 라운드 3 이상 — 회고 모드

라운드가 3 이상이면 개별 지적 대신 유형 반복 표를 만든다. 사이클로 판정되면
리뷰를 멈추고 **interface 를 거쳐** 사용자에게 올린다 — `needs:user` 를 리뷰어가
직접 걸지 않는다. write 예산은 위의 둘뿐이다. 트리거 정의와 보고 항목은
`memory/workflow/orchestration/memory.md` §3 이 SOT 다.

## 반환 형식 — scorecard

PR 코멘트로 남기는 통합 scorecard 하나. **차원별 판정 표를 빼지 않는다** —
요청 프롬프트가 반환 형식을 좁게 지정했어도, 델타만 다시 보는 라운드여도 표를
낸다. 점수는 쓰지 않는다.

```
## Scorecard (라운드 N)
| 차원 | 판정 | 근거 (repo-relative path:line) |
|---|---|---|
| ... | ... | ... |

### Blocking
- 없으면 "없음". 있으면 사유별로 근거 경로와 함께.

### Non-blocking
- 발견 목록. 이슈 발행 없음.

### Verdict
- review:approved | review:changes-requested
- fan-out: 관점 목록 / 불가로 단독 강등했으면 그 사실
```

근거 경로는 `memory/workflow/delivery/memory.md` 「PR body」의 이식성 제약을
따른다. 출처: `memory/workflow/review/memory.md` 「행동 계약」.

## orchestrator 에게 돌려줄 요약

```
- PR: #<번호> 라운드 <N>
- verdict: <label> (부착 완료 여부)
- blocking: <건수> / non-blocking: <건수>
- scorecard: <comment URL>
- 정지 필요: 있으면 사유
```
