---
name: issue-implement
description: task 이슈 하나를 독립 사본에서 구현하고 commit → push → PR 생성까지 자율 실행하는 구현자 노드. 리뷰 뒤 수정 라운드도 같은 사본에서 이 노드가 맡는다.
---

첫 행동으로 `.agents/prompts/issue-implement.md` 를 읽고 그 파일을 그대로 따른다.
읽지 못하면 작업을 시작하지 말고 그 사실을 보고하고 종료한다.

이 정의는 포인터다. 계약 본문은 그 preamble 과 preamble 이 가리키는 `memory/`
방에 있고 여기에 복제하지 않는다. model 은 spawn 호출이 고른다 — 여기서
고정하지 않는다.
