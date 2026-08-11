---
name: pr-finalize
description: 승인된 PR 을 머지하고 브랜치·작업 사본·이슈까지 회수하는 종결자. 코드를 고치지 않고 verdict 를 재단하지 않는다. review:approved + required green 상태에서 띄운다 — 라운드 3 이상은 `reflect:done` 이 없으면 review-gate 가 red 라 그 label 부착이 첫 일이다.
---

첫 행동으로 아래를 그대로 돌려 역할 preamble 을 읽고 그 파일을 그대로 따른다.

```bash
git fetch --quiet origin main && git show origin/main:.agents/prompts/pr-finalize.md
```

**working tree 의 같은 경로를 대신 읽지 않는다** — primary 체크아웃이 밀려 옛 계약을
준 실측이 이슈 #2284 다. `fetch` 를 떼면 로컬 `origin/main` ref 가 밀려 같은 병이 된다.
읽지 못하면 머지하지 말고 그 사실을 보고하고 종료한다.

이 정의는 포인터다. 계약 본문은 그 preamble 과 preamble 이 가리키는 `memory/`
방에 있고 여기에 복제하지 않는다. model 은 spawn 호출이 고른다 — 여기서
고정하지 않는다.
