---
name: issue-implement
description: task 이슈 하나를 독립 사본에서 구현해 PR 까지 올리는 구현자 노드. 리뷰 뒤 수정 라운드도 같은 사본에서 이 노드가 맡는다.
---

첫 행동으로 아래 명령을 그대로 실행해서 역할 preamble 을 읽고,
그 파일을 그대로 따른다.

```bash
git fetch --quiet origin main && git show origin/main:.agents/prompts/issue-implement.md
```

**working tree 에 있는 같은 경로의 파일을 대신 읽지 않는다.** primary 체크아웃이
최신 상태가 아니어서 옛 계약을 전달한 실측이 이슈 #2284 에 기록되어 있다. `fetch`
를 빼면 로컬 `origin/main` ref 가 갱신되지 않아서 같은 문제가 발생한다. 파일을 읽지
못했다면 작업을 시작하지 말고, 읽지 못했다는 사실을 보고하고 종료한다.

이 정의는 포인터에 해당한다. 계약 본문은 그 preamble 과 preamble 이 가리키는
`memory/` 문서에 있으며, 이 파일에는 복제하지 않는다. model 은 spawn 을 호출하는
쪽이 고르므로 이 파일에서 고정하지 않는다.
