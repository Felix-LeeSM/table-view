# Sprint Execution Brief: sprint-386

## Objective

Memory palace + agent harness 인프라 개선. auto-memory 협업 룰 12 항목을 repo 로 이동 (reframe 포함), 신규 방 5 / sub-room 8 생성, agent definition 9 신설, god file 인지 hook 도입, `remember` skill type 매트릭스 확장, by-task/by-surface index 자동화.

## Task Why

- 사용자 6 목표 중 2 (읽기 친화 indexing), 3 (hook 강제), 4 (TDD harness), 5 (grill + html), 6 (caveman 자동) 직접 진전.
- Auto-memory 12 항목이 user-claude 협업 layer 인데 repo 는 코드 룰만 다뤄서 갭. 본 sprint 가 그 갭을 closing.
- 메모리에 룰 박아도 *작업 중 인지* 보장이 안 됨 (god file 예) — 3 layer (hook / agent prompt / index) 의 첫 적용.

## Scope Boundary

- 메모리 14 결정 이동 (1-12, 14; 13 미이동) — 변형 룰은 contract `In Scope` 표 그대로.
- 신규 방 8개 + index 2개 + agent definition 9개 + hook 1개 + skill 갱신 1개 + script 2개.
- **NOT IN SCOPE** — R2 전면 채택, worktree 자동화, sprint INDEX, glossary, 기존 메모리 retrofit.

## Invariants

- ADR 본문 동결.
- `memory/` 트리 `memory.md` 만 (예외 `memory/index/*.md`).
- 200줄 cap.
- `--no-verify` 금지.
- 기존 cross-link 보존.

## Done Criteria

1. AC-01 ~ AC-10 모두 통과 (contract).
2. 모든 검증 명령 (tsc / lint / vitest / cargo clippy / cargo test) 통과.
3. auto-memory 13 만 잔존.
4. handoff.md 완성 — Deferred work 포함.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. 신규 방 8 + index 2 + agent 9 + script 2 + hook entry — 정적 존재 확인 (find / ls / grep)
  2. 200줄 cap + memory.md 룰 — `scripts/check-memory-size.sh` + `scripts/check-memory-structure.sh`
  3. god file hook 실제 trigger — temp 500+줄 fixture
  4. ESLint max-lines / Clippy 결과
  5. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
  6. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
- Required evidence:
  - 파일 목록 + 각 본문 line count
  - 9 agent definition tools/권한 매핑 표
  - god file hook stderr 캡처
  - 14 결정 이동 결과 (auto-memory diff)

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence
- Assumptions made during implementation
- Residual risk or verification gaps

## References

- Contract: `docs/sprints/sprint-386/contract.md`
- Findings: `docs/sprints/sprint-386/findings.md` (생성 예정)
- Relevant files:
  - 현 `memory/memory.md` 및 자식 방 8개 (architecture/, conventions/, decisions/, lessons/, roadmap/)
  - `/Users/felix/.claude/projects/-Users-felix-Desktop-study-view-table/memory/` (auto-memory 14 파일)
  - `.claude/skills/` 13 skill, `.claude/commands/remember.md`, `.claude/commands/split-memory.md`
  - `.claude/hooks/pre-bash.sh`, `.claude/settings.json`, `lefthook.yml`
  - `.claude/rules/git-policy.md`, `.claude/rules/test-scenarios.md`
  - `eslint.config.js`, `src-tauri/clippy.toml` (있다면)
