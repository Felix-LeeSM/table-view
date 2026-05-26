---
title: Terminology — gate and collision locks
type: convention
updated: 2026-05-26
task: terminology, naming, glossary, domain-language, user-review, harness
surface: memory, docs, agents, ui-copy, tests
---

# Terminology

Repo-wide 용어 lock. 일반 사전이 아니다. agent 권한/gate 를 바꾸는 단어와
실제 충돌 evidence 가 있는 domain/UI 용어만 저장한다.

## 저장 기준

- **Pre-lock 허용**: agent 권한, gate, 위험 행동 해석을 바꾸는 단어.
- **Evidence 필요**: domain/UI/code 용어. 사용자/문서/코드/test 사이 실제 혼동
  사례나 sprint evidence 가 있어야 한다.
- **저장 금지**: 일반 SW 용어, 한 번 나온 임시 표현, local 변수명, 정의해도 행동이
  안 바뀌는 단어.
- 용어 변경은 docs/tests/prompts/memory 영향까지 본다.

## Agent gate terms

| Term | 뜻 | 금지 혼동 |
|---|---|---|
| `Reviewer` | read-only 검증 agent. harness Evaluator / PR pr-reviewer 역할을 수행할 수 있다. | 사용자 review 와 동일시 금지 |
| `user review` | 사용자가 PR/요약/evidence 를 보고 명시적으로 검토한 행위. | agent scorecard, CI 통과와 동일시 금지 |
| `approval` | 특정 행동에 대한 사용자 허가. 대상 action 이 명시돼야 한다. | "좋아"를 merge/force-push 등 다른 action 승인으로 확대 금지 |
| `user-review-ready` | agent 가 사용자에게 review 를 요청할 수 있는 상태. checks/review/evidence 조건을 만족했다는 뜻. | user review 완료 아님 |
| `gate evidence` | pass/ready 판단에 쓰는 재확인 가능한 근거. file diff, test, CI, browser/API 확인, PR comment, static inspection. | agent 자기보고 금지 |
| `pass` | evidence 로 확인된 완료 상태. | "agent 가 했다고 말함"으로 pass 금지 |

## 적용 gate

- PR/review/handoff 가 agent gate terms 를 다른 뜻으로 쓰면 review finding.
- Naming/UI copy/docs/tests 를 바꾸는 작업은 본 방 read evidence 를 남긴다.
- Evidence-backed domain terms 를 건드렸는데 본 방을 읽지 않았으면 review finding.
- 새 domain/UI 용어 충돌을 발견하면 먼저 evidence path 를 남기고 본 방 갱신 여부를
  결정한다.

## Evidence-backed domain terms

| Term set | Lock | Evidence |
|---|---|---|
| RDB vs Mongo record terms | RDB: `table` / `row` / `column`. Mongo: `collection` / `document` / `field`. UI copy 에서 paradigm 을 섞지 않는다. | `docs/sprints/sprint-118/spec.md`, `docs/ux-laws-mapping.md` |

## 갱신 규칙

- agent gate 용어가 바뀌면 관련 workflow room 도 링크 갱신.
- domain/UI 용어를 추가하려면 evidence path 를 함께 남긴다.
- UI copy 를 바꾸면 tests/snapshots/문서의 사용자 노출 문자열 확인.
- 용어 충돌을 고친 sprint 는 `run.md` 에 read evidence + changed terms 를 남긴다.
- `memory/` 갱신 후 `bash scripts/regenerate-indexes.sh`.

## 관련

- [workflow](../workflow/memory.md) — agent/workflow phase 룰
- [harness](../workflow/harness/memory.md) — harness worker/topology
- [delivery](../workflow/delivery/memory.md) — user review gate
- [review](../workflow/review/memory.md) — Reviewer/pr-reviewer scorecard
- [conventions](../conventions/memory.md) — code/test naming conventions
