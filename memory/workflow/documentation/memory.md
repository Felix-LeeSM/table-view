---
title: Documentation Impact Gate
type: workflow-rule
updated: 2026-05-19
task: documentation, docs, pr, review, delivery
trigger:
  signal: PR 작성 / 문서 추가 / workflow·contract·user-facing 변경
  layer: agent-prompt (issue-implement + pr-reviewer)
---

# Documentation Impact Gate

모든 PR 은 "문서가 필요한가?" 와 "기존 SOT 어디에 반영했나?" 를 먼저
판단한다. 새 문서 생성은 마지막 선택지이며, 기존 체계 우회 금지.

## Documentation impact 판단

PR body 형식 요구는 없다. 아래 세 질문에 스스로 답하고, 답을 남길 곳은
PR body / 커밋 메시지 / 리뷰 코멘트 중 아무 곳이나 고른다.

- 문서화가 필요한가 (아래 트리거 목록).
- 필요하면 기존 SOT 중 어디를 갱신했나 (repo-relative path).
- 불필요하다면 왜인가 — "작아서" 가 아니라 "test-only, public behavior 0"
  처럼 트리거가 없음을 짚는다.

## 문서화 필요 트리거

- 사용자 가시 동작 변경: UI flow, shortcut, warning/confirm, default 값.
- contract 변경: IPC payload, store/hook API, enum, SQL kind/severity.
- workflow/rule 변경: agent, review, delivery, git, hook 정책.
- safety/security 변경: password, signing, destructive command, safe mode.
- 운영/검증 변경: CI, pre-push, test strategy, coverage threshold.
- architecture/invariant 변경: 앞으로 지켜야 할 설계 제약.
- deferred risk/follow-up 발생: 지금 안 고치는 이유와 추적 위치 필요.

## 기존 SOT 라우팅

| 내용 | SOT |
|---|---|
| sequencing / 다음 sprint 후보 | `docs/ROADMAP.md` |
| 실제 sprint 범위 / AC / handoff | `docs/sprints/sprint-N/` |
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
- 금지: `/Users/...`, `/tmp/...`, `file://...`, `worktrees/...`, 로컬 plan path.
- 로컬 임시 로그는 요약을 붙이고, 재현 명령 또는 repo artifact 로 대체.

## Reviewer 판정

pr-reviewer 는 다음을 blocking finding 으로 본다. 셋 다 **내용**에 관한 것이고,
body 에 어떤 섹션이 있는지는 더 이상 판정 대상이 아니다:

- 문서화 트리거가 있는데 어떤 SOT 도 갱신되지 않음.
- 기존 SOT 대신 새 backlog/plan 디렉토리를 만들고 retire 조건 없음.
- PR 에서 볼 수 없는 로컬 절대경로를 근거로 사용.
- workflow/rule 변경인데 `memory/workflow/**` 갱신 없음.

## 관련

- [delivery](../delivery/memory.md) — commit → push → PR 행동 계약
- [review](../review/memory.md) — documentation topology 평가
- [git-policy](../git-policy/memory.md) — hook / signing safety
