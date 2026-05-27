---
title: Documentation Impact Gate
type: workflow-rule
updated: 2026-05-19
task: documentation, docs, pr, review, delivery
trigger:
  signal: PR 작성 / 문서 추가 / workflow·contract·user-facing 변경
  layer: agent-prompt (delivery + pr-reviewer)
---

# Documentation Impact Gate

모든 PR 은 "문서가 필요한가?" 와 "기존 SOT 어디에 반영했나?" 를 먼저
판단한다. 새 문서 생성은 마지막 선택지이며, 기존 체계 우회 금지.

## Documentation impact 필수 판단

PR body 에 다음 섹션을 포함:

```markdown
## Documentation impact
- Required: yes|no
- Trigger: <user-facing|contract|workflow|safety|ops|architecture|risk|none>
- Updated SOT: <repo-relative paths, or n/a>
- Reason: <필요/불필요 판단 근거>
```

`Required: no` 도 근거 필수. "작아서" 가 아니라 "test-only, public behavior
0" 처럼 문서화 트리거가 없음을 명시.

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
| 현재 사용자-visible 제한 | `docs/product/known-limitations.md` 또는 `docs/product/README.md` |
| 미래 follow-up / 승격 후보 | `docs/ROADMAP.md` |
| 구조적 제약 | architecture SOT (`docs/data-source-architecture.md` 등) |
| 개발/운영 검증 제약 | `docs/contributor-guide/**` |
| 과거 risk register / 사건 | `docs/archives/**` |
| 임시 audit 원문 | 사용자 명시 승인 + retire 조건 필수 |

임시 `docs/<new-area>/` 는 SOT 가 아니다. 만들기 전 PR body 에 owner SOT,
retire 조건, 흡수 계획을 적고 사용자 승인을 받는다.

## Evidence portability

PR body / review comment / handoff 는 GitHub 에서 확인 가능한 증거만 사용:

- 허용: repo-relative `path:line`, GitHub PR/commit/check URL.
- 금지: `/Users/...`, `/tmp/...`, `file://...`, `worktrees/...`, 로컬 plan path.
- 로컬 임시 로그는 요약을 붙이고, 재현 명령 또는 repo artifact 로 대체.

## Reviewer gate

pr-reviewer 는 다음을 blocking finding 으로 본다:

- 문서화 트리거가 있는데 `Required: no` 이거나 Updated SOT 없음.
- 기존 SOT 대신 새 backlog/plan 디렉토리를 만들고 retire 조건 없음.
- PR 에서 볼 수 없는 로컬 절대경로를 body/comment 근거로 사용.
- workflow/rule 변경인데 `memory/workflow/**` 또는 관련 wrapper 갱신 없음.

## 관련

- [delivery](../delivery/memory.md) — PR body + merge gate
- [review](../review/memory.md) — documentation topology 평가
- [git-policy](../git-policy/memory.md) — hook / signing safety
