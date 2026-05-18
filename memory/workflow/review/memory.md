---
title: PR Review — 자동 layer + 정성 pr-reviewer
type: workflow-rule
updated: 2026-05-18
task: review, pr-reviewer, scorecard, profile
trigger:
  signal: PR 생성 / 사용자가 "리뷰해" / delivery T4
  layer: agent-prompt (pr-reviewer agent) + hook (scripts/review/*)
---

# PR Review

PR 한 건 = 자동 layer (hook / lint / script) + 정성 layer (pr-reviewer agent 1
spawn). agent 가 매번 bash 명령 돌리지 않도록 정량은 모두 자동 layer 로 빠짐.

## 2층 구조

```
T0 ~ T3 코드 변경 / commit / push     ← Bash hook + lefthook 가 실시간 차단
T4       pr-reviewer spawn (1 회)      ← 정성 3 차원만
T5       사용자 / 자동 머지 결정      ← scorecard + CI 결과 input
```

### 자동 layer (agent 안 봄)

| 차원 | script | 트리거 |
|---|---|---|
| Dangerous Bash | `scripts/hooks/check-dangerous-bash.sh` | Bash PreToolUse |
| Memory cap / 구조 / index | `scripts/check-memory-structure.sh` | PostToolUse Edit/Write + pre-commit |
| Wrapper cap | `scripts/check-wrapper-cap.sh` | PostToolUse Edit/Write |
| God file | `scripts/check-god-file.sh` | PostToolUse Edit/Write |
| ADR 동결 | `scripts/check-adr-frozen.sh` | pre-commit |
| Conventional Commits | lefthook `commit-msg` | commit-msg |
| 회귀 (tsc / lint / clippy / test / coverage) | lefthook `pre-push` 7 stage | pre-push |
| TDD 사이클 (code profile) | `scripts/check-tdd-cycle.sh` | pre-push (8 stage) |
| CI (PR check) | GitHub Actions | PR 생성 시 |
| AC 명령 기반 | `scripts/review/run-checks.sh <sprint>` | pr-reviewer 호출 시 / 사용자 |

→ 머지 차단 = 자동 layer 실패. agent 가 위 차원을 다시 확인하지 않음.

### 정성 layer (pr-reviewer 1 spawn)

pr-reviewer 가 보는 3 차원 — 모두 script 로 잡기 어려운 의미 판단:

**1. Mock 범위**
- `git diff origin/main...HEAD` 의 test 파일에서 `vi.mock(...)` 인자 분석
- 광역 패턴 (`@lib/*`, `@/stores/*`, `../stores/*`) = 위반
- 우리 own 코드 mock = 위반
- lib boundary (`@tauri-apps/api/core::invoke`, fetch) stub = OK
- 1-10 점 + 위반 파일 list

**2. 정합성**
- 새 룰 / 문서 / 코드 변경이 기존 ADR + memory + 코드 현실과 일치?
- 자기 모순 (예: `type: skill` 사용했는데 매트릭스에 없음)
- 중복 source (같은 룰이 wrapper + memory 양쪽)
- **외부 plugin / skill 영역 침범** (sprint-388 발견):
  - `.claude/skills/<x>/` — skill plugin 영역. 본 repo 가 수정 금지
  - `.claude/plugins/<x>/` (있다면) — plugin 영역
  - `node_modules/`, `src-tauri/target/`, `vendor/` — 외부 SDK / 빌드 산출물
  - `.claude/settings.local.json`, `.env*` — gitignored / user-local
  - `worktrees/`, `.claude/worktrees/` — runtime 인스턴스 격리
- **다른 sprint scope 침범** — 본 PR 이 다른 sprint 의 `docs/sprints/sprint-N/`
  변경 (회고 보강은 예외, 사용자 명시 시만)
- 1-10 점 + 모순 / 침범 항목 list

**3. Sprint contract scope**
- contract "In Scope" 외 변경 (scope creep)
- "In Scope" 누락 (작업 안 한 항목)
- "Out of Scope" 명시 영역 손댐
- invariant 위반
- 1-10 점 + 위반 항목 list

## Profile 분기

contract frontmatter `review-profile` 필드:

| profile | 적용 정성 차원 | 적용 자동 차원 |
|---|---|---|
| `code` | Mock + 정합성 + Scope | 공통 + TDD + Coverage threshold |
| `security` | 정합성 + Scope + Threat-model 정합 | 공통 + ADR 동결 강제 |
| `infra` | 정합성 + Scope + Platform-neutral + Hook 한계 | 공통 |
| `docs` | 정합성 + Scope | 공통 (Coverage / TDD N/A) |

**공통 자동 layer**: dangerous Bash / memory 구조 / wrapper cap / god file /
conventional commit / pre-push 7 stage.

pr-reviewer 가 spawn 시:
1. `gh pr view <N> --json title` → sprint number 추출 (제목 정규식 `sprint-<N>`)
2. contract.md frontmatter 파싱 (`review-profile`)
3. 위 매트릭스 룩업 → 정성 차원 결정
4. 각 차원 평가 (1-10) + 결함 list + Action items
5. 출력 = scorecard PR comment 게시

## Scorecard 출력 형식

```markdown
## 자동 layer
- ✓ scripts/check-memory-structure.sh
- ✓ scripts/check-wrapper-cap.sh
- ✓ scripts/check-god-file.sh
- ✓ scripts/check-adr-frozen.sh
- ✓ pre-push 7 stage (tsc / lint / tauri-check / cargo-deny / cargo-machete / rust-cov / ts-test)
- ✓ scripts/review/run-checks.sh (Required Checks X/X)

## 정성 차원 (profile: <name>)
| 차원 | 점수 | 결함 |
|---|---|---|
| Mock 범위 | N/10 | ... |
| 정합성 | N/10 | ... |
| Scope | N/10 | ... |

## Action items
1. ...
2. ...
```

## Delivery 통합

`memory/workflow/delivery/memory.md` 의 T4 (Review) 단계:

1. **default**: agent A 가 push + PR 직후 `pr-reviewer` agent spawn
2. **option**: 사용자가 "codex 리뷰도 받아" → `codex-reviewer` 추가 spawn
3. **자율 머지 조건** (T6):
   - 정성 4 차원 모두 ≥ 7/10
   - CI green (`gh pr checks` SUCCESS)
   - 사용자 명시 거부 없음
   → `gh pr merge --squash --delete-branch` 자율 실행
4. **fix loop**: 결함 발견 → agent A 가 fix commit + push → T1 재시작

## Anti-patterns

- pr-reviewer 가 bash 로 `cargo test` / `pnpm vitest` 다시 돌리는 것. **금지**.
  자동 layer 가 이미 함. pr-reviewer 는 결과 input 받기만.
- self-eval (구현한 agent = pr-reviewer agent). **회피** — pr-reviewer 는 별 spawn,
  편향 차단.
- profile N/A 차원을 보고서에 "N/A" 로 명시. **회피** — 매트릭스에서 빠진 차원
  은 출력 자체에서 제거.
- **harness skill (`.claude/skills/harness/`) 파일 수정**. **금지** — skill
  plugin 영역. harness 의 `evaluator` prompt 는 본 룰과 직교, 별 룰. repo 의
  review 룰은 본 방 (pr-reviewer agent), harness skill 은 자체 룰 — 두 룰
  독립 진화. agent 이름을 `evaluator` 가 아닌 `pr-reviewer` 로 한 것도 skill
  의 evaluator 와 혼동 회피 (sprint-388 lock).

## 관련

- `.claude/agents/pr-reviewer.md` — wrapper
- `scripts/review/run-checks.sh` — contract Required Checks batch
- `memory/workflow/delivery/memory.md` — T4 review 통합
- `memory/workflow/grill/memory.md` — review 와 직교 (grill = 결정 인터뷰)
