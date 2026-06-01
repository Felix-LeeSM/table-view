---
name: pr-review
description: PR 정성 리뷰를 수행할 때 사용. 자동 검증 결과를 입력으로 삼고, test/lint 재실행 없이 profile별 정성 차원(Mock/정합성/Scope/PR body 등)을 평가해 PR comment scorecard와 action items를 작성한다.
---

# PR Review

PR review는 자동 layer와 정성 layer를 분리한다. Hook, lint, typecheck, test,
CI, Required Checks는 자동 layer다. Reviewer는 이 검사를 다시 돌리는 사람이
아니라, 자동 layer가 잡기 어려운 의미 판단을 하는 read-only 평가자다.

## Inputs

1. PR title/body/diff.
2. 대상 sprint가 있으면 `docs/sprints/sprint-<N>/contract.md`.
3. Required Checks가 있으면 `bash scripts/review/run-checks.sh <N>` 출력.
4. 정합성 판단에 필요한 active memory/docs/code.
5. CI 상태가 필요하면 `gh pr checks <N>`.

로컬 절대경로, 임시 파일 경로, worktree 경로를 evidence로 쓰지 않는다. PR comment와
summary에는 repo-relative path 또는 GitHub URL만 남긴다.

## Output Contract

- `pr-reviewer` coordinator는 최종 통합 scorecard를 PR에 직접 comment로 남긴다.
- Subreviewer 결과는 coordinator의 내부 입력이다. Subreviewer는 PR comment를
  남기지 않는다.
- Comment 작성이 도구/권한 문제로 실패하면 최종 응답에 실패 원인과 붙일
  scorecard 본문을 그대로 반환한다.
- 같은 review round에는 통합 comment 1개만 남긴다. follow-up review round는 새
  commit/push 후 별도 comment를 남긴다.

## Boundaries

- Reviewer는 read-only다. commit, push, merge, branch 수정 금지.
- `cargo test`, `pnpm vitest`, `npm run lint` 같은 정량 검사는 재실행하지 않는다.
- 자동 layer 실패는 review 결함으로 보고하되, reviewer가 우회하거나 고치지 않는다.
- 구현 agent의 self-review를 피한다. 가능하면 별도 reviewer agent가 본다.
- External reviewer는 사용자가 명시적으로 요청했을 때만 추가한다.

## Review Pack

`pr-reviewer`는 coordinator다. 작은 PR은 단독 평가한다. 변경이 넓거나 위험하면
전용 read-only `pr-subreviewer`를 관점별로 2-4개 fan-out한 뒤 하나의
scorecard로 합친다.
Subreviewer도 이 skill의 Boundaries를 상속한다.
각 subreviewer는 같은 immutable input을 받고, 서로의 결과를 보기 전에 독립
산출물을 반환한다.
Coordinator는 `pr-subreviewer` 외 agent를 subreview 용도로 spawn하지 않는다.
`delivery`, `tdd-generator`, `bug-fix`, `codex-reviewer` 같은 write-capable 또는
external reviewer agent는 subreviewer가 아니다.

기본 관점:

- `code-semantics`: runtime/source diff, behavioral regression, edge case.
- `test-quality`: mock 범위, user-facing assertion, RED/contract evidence.
- `sot-scope-docs`: active memory/docs/ADR 정합성, scope, PR body, evidence.
- `security-infra`: credential/destructive/signing/CI/hook/build risk.

선택 규칙:

- `code`: `code-semantics`, `test-quality`, `sot-scope-docs`.
- `docs`: `sot-scope-docs`.
- `infra`: `security-infra`, `sot-scope-docs`.
- `security`: `security-infra`, `sot-scope-docs`, 필요한 `code-semantics`.
- 관련 diff가 없으면 해당 관점은 생략한다. 같은 관점 중복 spawn은 금지한다.

Subreviewer 출력은 `관점`, `blocking findings`, `non-blocking notes`, `evidence
coverage`만 포함한다. Coordinator는 중복을 합치고, 가장 높은 severity를 유지한다.
한 관점이라도 blocking이면 최종 verdict는 blocking이다. 점수 평균으로 blocking을
희석하지 않는다.

## Profile 선택

우선순위:

1. Sprint contract frontmatter의 `review-profile`.
2. Contract가 없으면 변경 파일로 추론:
   - runtime/source/test 변경 포함: `code`
   - docs/memory/agent wrapper 중심: `docs`
   - hook, CI, build, release tooling 중심: `infra`
   - auth, secret, destructive action, credential, signing 중심: `security`

## 평가 차원

### Mock 범위 (`code`)

- test diff의 `vi.mock(...)` / module mock을 본다.
- 외부 boundary stub은 허용: Tauri `invoke`, network, filesystem, DB adapter 등.
- own code, store, hook, util 전체 mock은 위반으로 본다.
- 사용자가 보는 behavior를 막는 assertion인지 확인한다.

### 정합성 (공통)

- 새 룰/문서/코드가 active memory, ADR archive, 코드 현실과 충돌하지 않는가?
- 같은 source of truth가 wrapper, memory, skill, docs에 중복 구현되지 않았는가?
- repo-owned skill은 `.agents/skills/<name>/SKILL.md`가 source인지 확인한다.
- 외부/plugin/generated/local 영역을 수정하지 않았는가.
- 다른 sprint scope를 침범하지 않았는가.

### Scope (공통)

- contract의 In Scope가 구현되었는가.
- Out of Scope를 건드리지 않았는가.
- invariant와 acceptance criteria가 실제 diff/검증 결과로 충족되는가.
- scope가 없으면 PR body의 명시 목표를 기준으로 본다.

### PR Body / Documentation Impact (공통)

- `Documentation impact`가 변경 내용과 맞는가.
- `Smoke-Test-Plan:`이 있고, runtime journey 영향 판단이 타당한가.
- user-facing, contract, workflow, safety, ops, architecture, risk 변경이
  기존 SOT에 반영되었는가.
- PR body/comment의 evidence가 GitHub에서 확인 가능한가.

### Security (`security`)

- secret/credential/plaintext boundary가 명확한가.
- destructive action에는 dry-run, confirmation, auditability가 있는가.
- threat model 또는 security handoff가 필요한데 빠지지 않았는가.

### Infra (`infra`)

- platform-neutral한가.
- hook/CI/build script가 read-only gate와 repair step을 섞지 않는가.
- local-only path, env, tool assumption을 repo policy로 고정하지 않았는가.

## Scorecard Format

```markdown
## 자동 layer
- <status> <check or source>

## 관점 입력
- <perspective>: pass|blocking — <short basis>

## 정성 차원 (profile: <name>)
| 차원 | 점수 | 결함 |
|---|---:|---|
| 정합성 | N/10 | ... |
| Scope | N/10 | ... |
| PR body | N/10 | ... |

## Action items
1. ...
```

Profile에 적용되지 않는 차원은 출력하지 않는다. "N/A" 행으로 채우지 않는다.

## Verdict

- Red / Blocking: 자동 layer 실패, score < 8, contract miss, SOT 충돌, scope 침범,
  로컬 evidence, reviewer boundary 위반.
- Green / Pass: 적용 차원 모두 8/10 이상이고 blocking item이 없다.
- 8/10은 "merge-ready with bounded residual risk"다. 7/10은 "works but needs
  reflection"이므로 red/blocking으로 취급한다.
- 결함이 있으면 delivery owner가 고친 뒤 reviewer가 다시 본다.

## Related

- `memory/workflow/review/memory.md` — review phase 행동 계약
- `memory/workflow/delivery/memory.md` — T4/T5/T6 통합
- `memory/workflow/documentation/memory.md` — Documentation impact gate
- `scripts/review/run-checks.sh` — sprint Required Checks runner
