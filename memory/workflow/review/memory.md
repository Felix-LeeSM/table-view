---
title: PR Review — 자동 layer + 정성 pr-reviewer + user review gate
type: workflow-rule
updated: 2026-05-26
task: review, pr-reviewer, scorecard, profile, user-review
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
T4       pr-reviewer spawn (1 회)      ← 정성 차원만
T5       delivery owner reflect / user-review-ready ← scorecard + CI 결과 input
```

### 자동 layer (agent 안 봄)

| 차원 | script | 트리거 |
|---|---|---|
| Dangerous Bash | `scripts/hooks/check-dangerous-bash.sh` | Bash PreToolUse |
| Memory cap / 구조 / index | `scripts/hooks/check-memory-structure.sh` | PostToolUse Edit/Write + pre-commit |
| Wrapper cap | `scripts/hooks/check-wrapper-cap.sh` | PostToolUse Edit/Write |
| God file | `scripts/hooks/check-god-file.sh` | PostToolUse Edit/Write |
| ADR 동결 | `scripts/hooks/check-adr-frozen.sh` | pre-commit |
| Conventional Commits | lefthook `commit-msg` | commit-msg |
| 회귀 (tsc / lint / clippy / test / coverage) | lefthook `pre-push` stages | pre-push |
| TDD 사이클 (code profile) | `scripts/hooks/check-tdd-cycle.sh` | pre-push |
| CI (PR check) | GitHub Actions | PR 생성 시 |
| AC 명령 기반 | `scripts/review/run-checks.sh <sprint>` | pr-reviewer 호출 시 / 사용자 (allowlist runner) |

→ 머지 차단 = 자동 layer 실패. agent 가 위 차원을 다시 확인하지 않음.

### 정성 layer (pr-reviewer 1 spawn)

pr-reviewer 가 보는 정성 차원 — 모두 script 로 잡기 어려운 의미 판단:

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
- **Terminology gate** ([terminology](../../terminology/memory.md)):
  - `Reviewer` / `user review` / `approval` / `user-review-ready` / `pass`
    같은 agent gate term 을 locked meaning 과 다르게 쓰면 finding
  - naming / UI copy / docs / tests 를 바꾸며 관련 terminology read evidence 가
    없으면 finding
  - evidence-backed domain term 을 건드렸는데 locked term set 과 다르면 finding
- **외부 plugin / runtime 영역 침범**:
  - `.claude/plugins/<x>/` (있다면) — plugin 영역
  - 외부 배포 plugin 에서 온 `.claude/skills/<x>/`, `.codex/skills/<x>/` 파일 — 수정 금지
  - repo-owned `.claude/skills/<x>/`, `.codex/skills/<x>/` wrapper 는 memory /
    `.agents/skills` source 를 가리키는 얇은 파일만 허용
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

**4. PR body impact / topology**
- PR body 의 `Documentation impact` 판단이 변경 내용과 맞는가?
- PR body 의 `Smoke-Test-Plan:` 이 비어 있지 않고, 변경 내용과 맞는가?
- runtime DB write/read, Tauri command, connection/workspace routing,
  document grid/query 실행 경로, cross-window/event persistence, smoke 가
  의존하는 selector/ARIA 변경에서 `Not required` 라면 근거가 충분한가?
- "기존 smoke 로 충분" 판단은 spec path 와 보장 invariant 를 함께 남겼는가?
- smoke 를 새로 요구할 때 unit/integration 으로 동등하게 막히지 않는
  runtime journey 인가? e2e 는 늘리지 않는 것이 기본값이다.
- 문서화 트리거(user-facing / contract / workflow / safety / ops /
  architecture / risk)가 있는데 기존 SOT 갱신이 누락되지 않았는가?
- 새 `docs/<area>/` 또는 backlog 문서가 기존 `RISKS` / `PLAN` /
  `docs/sprints` / `memory` 체계를 우회하지 않는가?
- PR body/comment 에 `/Users`, `/tmp`, `file://`, `worktrees/` 같은
  GitHub 에서 볼 수 없는 근거가 없는가?
- 1-10 점 + 누락 / 위치 위반 / 로컬 증거 list

## Profile 분기

contract frontmatter `review-profile` 필드:

| profile | 적용 정성 차원 | 적용 자동 차원 |
|---|---|---|
| `code` | Mock + 정합성 + Scope + PR body | 공통 + TDD + Coverage threshold |
| `security` | 정합성 + Scope + Threat-model + PR body | 공통 + ADR 동결 강제 |
| `infra` | 정합성 + Scope + Platform-neutral + PR body | 공통 |
| `docs` | 정합성 + Scope + PR body | 공통 (Coverage / TDD N/A) |

**공통 자동 layer**: dangerous Bash / memory 구조 / wrapper cap / god file /
conventional commit / pre-push stages.

pr-reviewer 가 spawn 시:
1. `gh pr view <N> --json title` → sprint number 추출 (제목 정규식 `sprint-<N>`)
2. contract.md frontmatter 파싱 (`review-profile`)
3. 위 매트릭스 룩업 → 정성 차원 결정
4. 각 차원 평가 (1-10) + 결함 list + Action items
5. 출력 = scorecard PR comment 게시

## Scorecard 출력 형식

```markdown
## 자동 layer
- ✓ scripts/hooks/check-memory-structure.sh
- ✓ scripts/hooks/check-wrapper-cap.sh
- ✓ scripts/hooks/check-god-file.sh
- ✓ scripts/hooks/check-adr-frozen.sh
- ✓ pre-push stages (tsc / lint / tauri-check / cargo-deny / cargo-machete / rust-cov / ts-test / tdd-cycle)
- ✓ scripts/review/run-checks.sh (Required Checks X/X)

## 정성 차원 (profile: <name>)
| 차원 | 점수 | 결함 |
|---|---|---|
| Mock 범위 | N/10 | ... |
| 정합성 | N/10 | ... |
| Scope | N/10 | ... |
| PR body | N/10 | ... |

## Action items
1. ...
2. ...
```

## Delivery 통합

`memory/workflow/delivery/memory.md` 의 T4 (Review) 단계:

1. **default**: agent A 가 push + PR 직후 `pr-reviewer` agent spawn
2. **option**: 사용자가 "codex 리뷰도 받아" → `codex-reviewer` 추가 spawn
3. **user-review-ready 조건** (T6, delivery owner 책임):
   - 정성 4 차원 모두 ≥ 7/10
   - CI green (`gh pr checks` SUCCESS)
   - mergeable + branch policy unblocked
   → delivery owner 가 사용자에게 PR URL + checks/review 요약을 보고.
     사용자 명시 review + merge 승인 후에만 `gh pr merge --squash --delete-branch` 실행
4. **fix loop**: 결함 발견 → 같은 delivery owner 가 fix commit + push → T4 재시작

`pr-reviewer` scorecard 는 user review 의 입력일 뿐이다. agent 는 scorecard/CI
통과를 사용자 review 완료로 추정하지 않는다.

## Anti-patterns

- pr-reviewer 가 bash 로 `cargo test` / `pnpm vitest` 다시 돌리는 것. **금지**.
  자동 layer 가 이미 함. pr-reviewer 는 결과 input 받기만.
- self-eval (구현한 agent = pr-reviewer agent). **회피** — pr-reviewer 는 별 spawn,
  편향 차단.
- reviewer 가 commit / push / merge 수행. **금지** — reviewer 는 판단만,
  reflect / user-review 요청 / 승인 후 merge 는 delivery owner 책임.
- PR 에 로컬 절대경로를 근거로 남김. **금지** — repo-relative path 또는
  GitHub URL 로 변환.
- profile N/A 차원을 보고서에 "N/A" 로 명시. **회피** — 매트릭스에서 빠진 차원
  은 출력 자체에서 제거.
- harness evaluator 와 repo `pr-reviewer` 룰 혼동. harness prompt 는 harness
  workflow 용이고, PR review source 는 본 방이다.

## 관련

- `.claude/agents/pr-reviewer.md` — wrapper
- `scripts/review/run-checks.sh` — contract Required Checks batch
- `memory/workflow/delivery/memory.md` — T4 review 통합
- `memory/terminology/memory.md` — Reviewer / user review / evidence 용어
- `memory/workflow/documentation/memory.md` — Docs 차원 source
- `memory/workflow/grill/memory.md` — review 와 직교 (grill = 결정 인터뷰)
