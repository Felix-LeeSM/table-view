# Sprint Contract: sprint-386

## Summary

- Goal: Memory palace + agent harness 인프라 개선 — auto-memory 협업 룰 12 이동, 신규 방 5 (workflow/, ux/, runbook/, conventions sub-rooms), agent definition 8 신설, god file 인지 hook, `remember` skill type 매트릭스 확장.
- Audience: 모든 후속 agent (planner / generator / evaluator / bug-fix / refactor / delivery / reviewer). 본 sprint 결과가 후속 sprint 의 default 행동 룰 + 인지 layer base.
- Owner: orchestrator (현 세션).
- Verification Profile: `mixed` (static 메모리 / agent definition + command god-file hook + script regen)

## In Scope

### 메모리 이동 (14 결정 lock)

| # | 출처 (auto-memory) | 목적지 (repo) | 변형 |
|---|---|---|---|
| 1 | feedback_test_scenarios_user_journey | `memory/conventions/testing-scenarios/mock-scope/memory.md` (sub-room 신설) | 원본 보존 |
| 2 | feedback_bug_fix_starts_with_regression_test | `memory/workflow/bug-fix/memory.md` (workflow 방 신설) | 원본 보존 |
| 3 | feedback_test_documentation | `memory/conventions/testing-scenarios/memory.md` P7 확장 | 흡수 |
| 4 | feedback_security_rigor | `memory/workflow/grill/security-handoff/memory.md` | 원본 보존 |
| 5 | feedback_one_decision_at_a_time | `memory/workflow/grill/memory.md` 본문 | 원본 보존 |
| 6 | feedback_option_decomposition | `memory/workflow/grill/memory.md` 본문 | reframe — "기술 + 유저 플로우 두 축" |
| 7 | feedback_demo_html_for_grill | `memory/workflow/grill/memory.md` 본문 + `.claude/skills/grill-me/templates/option-comparison.html` | reframe — UI/복잡 워크플로우/예측 트리거, 동적 인터랙션 우선 |
| 8 | feedback_minimal_implementation_logs | `memory/workflow/implementation/memory.md` | reframe — agent 자율성 + tool noise 차단 |
| 9 | feedback_reset_to_default_ui | `memory/ux/memory.md` (ux 방 신설) | 원본 보존 |
| 10 | feedback_do_not_commit_diagnostic_logs | `memory/conventions/memory.md` 금지 사항 확장 | 일반화 (console.log → 임시 진단 일반) |
| 11 | feedback_git_commit_direct | `memory/workflow/delivery/memory.md` + `.claude/rules/git-policy.md` cross-ref | reframe — commit → push → PR → review → merge 전체 자율, agent spawn 가능 |
| 12 | feedback_sprint_comment_cleanup | `memory/conventions/refactoring/god-file/memory.md` (sub-room 신설) | reframe — god file 시퀀스 (탐지 ≥500줄 → 주석 단순화/이관 → 정합성 검증 → 그래도 크면 리팩토링) |
| 13 | reference_codex_review | **미이동** | auto-memory 유지. delivery review step 에서 사용자 질의로 호출 |
| 14 | reference_cold_boot_instrumentation | `memory/runbook/cold-boot/memory.md` (runbook 방 신설) | 부분만 — protocol + aggregation 만 (marker 위치는 코드 grep 으로 drift 회피) |

### 신규 방 / sub-room

- `memory/workflow/memory.md` (입구) — `bug-fix/`, `grill/` (`security-handoff/` 포함), `implementation/`, `delivery/`
- `memory/ux/memory.md`
- `memory/runbook/memory.md` (입구) — `cold-boot/`
- `memory/conventions/testing-scenarios/mock-scope/memory.md`
- `memory/conventions/refactoring/god-file/memory.md`
- `memory/index/by-task.md` (R3)
- `memory/index/by-surface.md` (R3)

### 인지 layer — god file 우선 적용 (R2 부분)

- `scripts/check-god-file.sh` — wc -l > 500 시 stderr 경고 + 룰 path 출력
- `.claude/settings.json` PostToolUse 에 god-file hook 등록 (Edit/Write `*.ts`, `*.tsx`, `*.rs`)
- ESLint `max-lines: 500` 룰 활성 (warn) — pre-commit 단계 보강
- Clippy 보강 — `clippy::too_many_lines` 활성 검토 (Threshold lib-default)

### Agent definition (R4 — 11.5 채택의 구현)

`.claude/agents/` 에 다음 정의 신설:

| Agent | 권한 | 시스템 prompt 핵심 |
|---|---|---|
| `caveman-default` | inherit | base — 모든 agent 의 출력 caveman 모드 |
| `grill-planner` | readonly + write(`docs/explorations/*.html`, `docs/sprints/*/contract.md`) | grill 1q + 두 축 옵션 분해 + html mock 트리거 + security-handoff 분기 |
| `tdd-generator` | write (Edit/Write/Bash) | RED commit → GREEN commit / cycle. god file 점검 후 진입. test 메타 주석 (Reason/Date/Purpose) 강제 |
| `evaluator` | readonly | 평가만, 코드 수정 금지. AC 단언 + 회귀 확인 |
| `bug-fix` | write | regression test 부터. tool output noise 차단. 임시 진단 log commit 금지 |
| `research` | readonly (Read/Grep/Glob/WebFetch) | 분석만, write 0 |
| `security-handoff` | write(`memory/security/**`, `docs/threat-models/**`) | threat-model 6 섹션 작성. grill 차단 |
| `delivery` | write + Bash(`git`, `gh`) | commit → push → PR → review (agent spawn 가능) → 반영 → merge. force-push / main 직접 push / 사용자 명시 거부 시 중단 |
| `codex-reviewer` | readonly + Bash(`codex exec` 만) | 큰 작업 끝 외부 리뷰 — 단 사용자 호출 시만 spawn |

모든 agent 의 첫 줄 = `먼저 caveman skill 발동. 출력 caveman 모드.`

### `remember` skill 갱신 (R1)

- `description` 갱신 — type 매트릭스 확장 명시
- 본문 type 표 8 type 화:
  - `convention` → `conventions/<area>/memory.md`
  - `workflow-rule` → `workflow/<phase>/memory.md` 또는 sub-room
  - `ux-rule` → `ux/memory.md`
  - `runbook` → `runbook/<topic>/memory.md`
  - `reference` → `reference/<tool>/memory.md` 또는 미이동
  - `ADR` → `decisions/NNNN-<slug>/memory.md`
  - `lesson` → `lessons/<domain>/YYYY-MM-DD-<slug>/memory.md`
  - `topic` (구조 변화) → `<area>/memory.md` 갱신
- 동작 단계 확장:
  1. type 판정
  2. 위치 계산
  3. 정합성 검증 — 기존 문서/메모리 모순 시 코드 보고 → 필요 시 사용자 질의
  4. reframe 가능성 점검 — 원본 룰을 일반화 / 부분 이동 / 미이동 옵션 제시
  5. 저장 + 인덱스 자동 갱신 + 트리거 layer 등록 (god file 같은 hook trigger 가능 신호 명시)
  6. frontmatter `trigger:` 필드 — R2 전면 채택 전이라도 옵션으로 기록 가능 (deferred 시점 사용)

### Index 자동 생성 (R3)

- `scripts/regenerate-indexes.sh` — `memory/**/*.md` frontmatter 읽어 `memory/index/by-task.md` + `memory/index/by-surface.md` 생성
- 각 메모리 파일에 frontmatter `surface:` (코드 영역 / 모듈) + `task:` (작업 의도 키워드) 필드 옵션 추가
- PostToolUse(`Edit memory/**`) hook 에 등록 — 메모리 변경 시 자동 재생성

### Auto-memory 처리

- 1-12, 14 이동분 → auto-memory 파일 삭제 (repo 가 source of truth)
- 13 → auto-memory 유지
- MEMORY.md (auto) 인덱스 갱신

## Out of Scope

- R2 인지 layer **전면** 채택 (god file 외 다른 룰의 hook/agent-prompt/index 자동 derive). 본 sprint 는 god file 만. 전면 채택 트리거 = god file hook 효과 측정 후 재평가 (handoff deferred 섹션).
- Multi-worktree 자동화 (`worktree-spawn` command, `EnterWorktree`/`ExitWorktree` 도구 wiring). 사용자 목표 1 직접 구현. 다음 sprint 후보.
- Sprint INDEX 자동 생성 (`docs/sprints/INDEX.md`). 사용자 첫 메시지 갭. 다음 sprint 후보.
- Sprint feedback 메모리 (`feedback_sprint_naming`, `reference_memory_palace`, `reference_build_commands`, `reference_ui_issues`) — 이미 repo 와 정합 / pointer 만 / docs 작업 목록. 본 sprint 범위 밖.
- Glossary / domain language 방 (사용자 첫 메시지 갭). 다음 sprint 후보.
- 기존 메모리 retrofit (frontmatter `surface:` / `task:` 일괄 추가). 신규만 적용, 기존은 자연 진화.

## Invariants

- ADR 본문 동결 — 결정 12 reframe 이 god-file sub-room 작성 시 기존 ADR 본문 미수정 (메타 / cross-link 만).
- `memory/` 트리는 `memory.md` 만 — 신규 방/sub-room 모두 동일.
- 200줄 cap 엄수 — 신규 방 본문 모두 200줄 이하.
- `.claude/rules/git-policy.md` 의 `--no-verify` 금지 + hook 강제 — agent definition 의 delivery 도 동일 적용 (force-push / main 직접 push 시 사용자 확인).
- 기존 메모리 cross-link 깨지지 않음 (auto-memory 이동 시 referencing 위치 모두 갱신).

## Acceptance Criteria

- `AC-01` 신규 방/sub-room 8개 (`workflow/memory.md`, `workflow/bug-fix/`, `workflow/grill/` + `security-handoff/`, `workflow/implementation/`, `workflow/delivery/`, `ux/memory.md`, `runbook/memory.md` + `cold-boot/`, `conventions/testing-scenarios/mock-scope/`, `conventions/refactoring/god-file/`) 생성. 각 본문 200줄 이하. 입구 (`workflow/memory.md`, `runbook/memory.md`) 는 방 지도 형식.
- `AC-02` `memory/memory.md` 입구의 방 지도 + CLAUDE.md "먼저 읽을 곳" 섹션에 신규 방 추가.
- `AC-03` 14 결정 항목 모두 reframe 결정대로 이동/미이동. auto-memory 파일 1-12, 14 삭제. MEMORY.md 갱신.
- `AC-04` `.claude/agents/` 9개 definition 파일 작성. 각 frontmatter (name, description, tools, model) + 시스템 prompt. caveman 자동 발동 1줄 포함.
- `AC-05` `scripts/check-god-file.sh` 작성 + `.claude/settings.json` PostToolUse 등록 + 실제 god file (≥500줄) 1개 이상에 대해 hook trigger 확인.
- `AC-06` ESLint `max-lines: 500` 활성 (warn). Clippy `too_many_lines` 검토 결과 (활성 또는 보류 사유) 기록.
- `AC-07` `.claude/commands/remember.md` 갱신 — 8 type 매트릭스 + 정합성 검증 + reframe / 부분 이동 / 미이동 옵션 + frontmatter `trigger:` 필드 옵션.
- `AC-08` `scripts/regenerate-indexes.sh` 작성. `memory/index/by-task.md` + `memory/index/by-surface.md` 첫 생성 + PostToolUse hook 등록.
- `AC-09` `docs/sprints/sprint-386/handoff.md` 의 "Deferred work" 섹션에 R2 전면 채택 trigger 조건 + 사용자 목표 1 (worktree) / sprint INDEX / glossary 후보 기록.
- `AC-10` 모든 검증 통과 — `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run`, `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`, `cargo test`.

## Design Bar / Quality Bar

- 신규 메모리 룰 본문 = 사용자 행동 룰 (workflow-rule) 또는 코드 룰 (convention). lesson 아님. 본문 lock — *결정 시점의 룰 본문 동결, 트리거/위치/cross-link 만 갱신 가능*.
- agent definition system prompt = 영구. caveman 1줄 + 역할 / 권한 / 트리거 신호 3 섹션.
- Hook script 출력 = noise 최소. 위반 시만 stderr, 통과 시 nothing.

## Verification Plan

### Required Checks

1. `find memory/workflow memory/ux memory/runbook memory/conventions/testing-scenarios/mock-scope memory/conventions/refactoring/god-file -name "memory.md" | wc -l` ≥ 8
2. `bash scripts/check-memory-size.sh` — 모든 memory.md 200줄 이하
3. `bash scripts/check-memory-structure.sh` — `memory/` 트리 `memory.md` 만 (예외 `index/*.md`)
4. `ls .claude/agents/*.md | wc -l` ≥ 9
5. `bash scripts/check-god-file.sh` 자체 unit smoke — 500줄 fixture 에 대해 trigger 확인
6. PostToolUse hook 실제 동작 — temp 500+ 줄 `.ts` 파일 Write 시 stderr 출력 캡처
7. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
8. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
9. ESLint `max-lines` 룰 위반 카운트 == 기존 god file 수 (regression 없음)
10. `bash scripts/regenerate-indexes.sh` 실행 후 `memory/index/by-task.md` / `by-surface.md` 생성 확인

### Required Evidence

- Generator must provide:
  - 신규 방/sub-room 파일 목록 + 각 본문 line count
  - 9 agent definition 파일 목록 + tools/권한 매핑 표
  - god file hook 작동 증거 (실제 stderr 캡처)
  - 14 결정의 이동/변형 결과 — auto-memory 삭제 확인 (1-12, 14) + repo 위치 확인
  - 검증 명령 outcomes
- Evaluator must cite:
  - 각 AC pass/fail 근거
  - 200줄 cap / `memory.md` only 룰 위반 여부
  - god file hook trigger 의 실제 출력 형식이 룰 path 가리키는지

## Test Requirements

### Unit Tests (필수)

- `scripts/check-god-file.sh` — fixture 1 (499줄), fixture 2 (500줄), fixture 3 (1000줄) 에 대한 동작 단언. shell test (bats 또는 plain `set -e` 패턴).
- `scripts/regenerate-indexes.sh` — mock `memory/foo/memory.md` (frontmatter `task: bar`) 에 대해 `by-task.md` 에 `bar` 등록 확인.

### Coverage Target

- 신규 script (`check-god-file.sh`, `regenerate-indexes.sh`) — 라인 70%+
- 신규 agent definition — 정적 검증만 (frontmatter 유효성)

### Scenario Tests (필수)

- [ ] Happy path — god file (≥500줄) Write 시 hook trigger + 메모리 path 출력
- [ ] 에러/예외 — 499줄 파일 Write 시 hook silent
- [ ] 경계 조건 — exactly 500줄 (≥ 비교) trigger 여부 lock
- [ ] 회귀 없음 — 기존 메모리 cross-link 깨짐 없음 (모든 `[link](path)` resolvable)
- [ ] auto-memory 삭제분 13 항목 중 13만 잔존

## Test Script / Repro Script

1. `cd /Users/felix/Desktop/study/view-table`
2. `bash scripts/check-memory-size.sh && bash scripts/check-memory-structure.sh`
3. Temp god file write 시뮬레이션:
   ```bash
   yes 'const x = 0;' | head -n 600 > /tmp/godfile-test.ts
   # PostToolUse 직접 호출 시뮬레이션
   echo '{"tool_input":{"file_path":"/tmp/godfile-test.ts"}}' | bash scripts/check-god-file.sh
   ```
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run --coverage`
5. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
6. `bash scripts/regenerate-indexes.sh && ls memory/index/`

## Ownership

- Generator: orchestrator 본인 (또는 `tdd-generator` agent spawn — 본 sprint 자체가 generator 정의 작성이라 self-bootstrap 단계라서 orchestrator 직접 추천).
- Write scope: `memory/**`, `.claude/agents/**`, `.claude/commands/remember.md`, `.claude/skills/grill-me/templates/**`, `.claude/settings.json` (hook 등록), `scripts/check-god-file.sh`, `scripts/regenerate-indexes.sh`, `eslint.config.js` (max-lines), `src-tauri/clippy.toml` (선택), `docs/sprints/sprint-386/**`.
- Merge order: 메모리 이동 → 신규 방 본문 → agent definition → hook → skill 갱신 → index 생성 → 검증 → handoff → commit (delivery agent 패턴 self-적용).

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
- handoff.md 의 "Deferred work" 섹션 완성 — R2 전면 / worktree / sprint INDEX / glossary 후보 기록
