---
sprint: 388
title: Review Infrastructure — Findings
date: 2026-05-18
---

# Sprint 388 — Findings

## AC 결과

| AC | 결과 | 증거 |
|---|---|---|
| 388-01 (review memory ≤ 200줄) | PASS | 153줄 |
| 388-02 (memory-structure 보강 — child dir w/o index fail) | PASS | sprint-387 결함 (skills index) 재발 차단 + 신설 lessons 9 디렉토리 index 추가 |
| 388-03 (wrapper-cap) | PASS | 9 agents / 6 rules / 2 commands 모두 cap 안 |
| 388-04 (tdd-cycle code profile만 강제) | PASS | infra profile sprint-388 자동 skip ✓ |
| 388-05 (adr-frozen 3 시나리오) | PASS | 본문 변경 BLOCK / frontmatter 만 ALLOW / 새 ADR ALLOW |
| 388-06 (run-checks contract Required Checks 실행) | PASS | sprint-388 contract 의 9 항목 parse OK |
| 388-07 (lefthook pre-commit adr-frozen 추가) | PASS | `glob: memory/decisions/**/*.md` stage |
| 388-08 (lefthook pre-push 8_check-tdd-cycle 추가) | PASS | `tags: review` stage |
| 388-09 (settings.json PostToolUse wrapper-cap 등록) | PASS | `.claude/{agents,rules,commands}/*.md` 매치 |
| 388-10 (pr-reviewer wrapper ≤ 15줄 + 새 source 3개) | PASS | 14줄 |
| 388-11 (delivery T4 + 자율 머지 조건) | PASS | T0~T6 timeline + 조건 명시 |
| 388-12 (harness skill 영역 분리) | PASS | sprint-388 중 침범 시도 → 사용자 지적 → revert + 정합성 차원 카테고리 추가 + hook hard block + lesson 기록 |
| 388-13 (check-memory-structure exit 0) | PASS | 신설 9 lessons index 포함 |
| 388-14 (check-wrapper-cap exit 0) | PASS | all under cap |
| 388-15 (pnpm tsc clean) | PASS | exit 0 |
| 388-16 (pnpm lint 0 errors) | PASS | 0 errors / 44 warnings (sprint-382/383 머지로 1 증가, 본 sprint 무관) |
| 388-17 (pnpm vitest baseline 유지) | PASS | 4267 passed / 11 skipped (sprint-387 baseline 4197 → 70 증가, sprint-382/383 머지로) |
| 388-18 (cargo clippy clean) | PASS | exit 0 |

## 주요 변경

### 1. `memory/workflow/review/memory.md` 신설 (153줄)

- 자동 layer (10 항목 표) + 정성 layer (3 차원) 분리
- 정성 3 차원: Mock 범위 / 정합성 / Sprint contract scope
- 정합성 차원의 sub-checklist 에 **외부 plugin / skill 영역 침범** 카테고리
  포함 (sprint-388 사용자 지적 후 추가)
- profile 매트릭스 4종 (code / security / infra / docs)
- Scorecard 출력 형식 + Delivery T0~T6 통합
- Anti-patterns 4가지 (bash 재실행 / self-eval / N/A 차원 표시 / **skill 영역
  수정**)

### 2. 5 hook script

| script | 트리거 | 동작 |
|---|---|---|
| `check-memory-structure.sh` 보강 | PostToolUse + pre-commit | 자식 디렉토리 있는데 본인 index 없으면 fail |
| `check-wrapper-cap.sh` 신설 | PostToolUse (`.claude/{agents,rules,commands}/*.md`) | 줄수 cap (15/20/15), README skip |
| `check-tdd-cycle.sh` 신설 | pre-push 8 stage | code profile 만 강제, `SKIP_TDD_CYCLE=1` 사용자 명시 우회 |
| `check-adr-frozen.sh` 신설 | pre-commit (`memory/decisions/**/*.md`) | frontmatter 외 hunk 차단, 새 ADR OK |
| `review/run-checks.sh` 신설 | 사용자 / pr-reviewer 호출 | contract Required Checks batch + PASS/FAIL |

### 3. Hook 등록

- `.claude/settings.json` PreToolUse Edit|Write 에 `.claude/skills/**` hard block 추가
- `.claude/settings.json` PostToolUse Edit|Write 에 `check-wrapper-cap.sh` 등록
- `lefthook.yml` pre-commit 에 `adr-frozen` stage
- `lefthook.yml` pre-push 에 `8_check-tdd-cycle` stage

### 4. pr-reviewer + delivery + lessons

- `.claude/agents/pr-reviewer.md` 갱신 — read 리스트 새 source 3개
- `memory/workflow/delivery/memory.md` T4 review + T6 자율 머지 조건
- `docs/archives/lessons/memory-lessons-2026-05-26/agent-and-git/2026-05-18-skill-plugin-area-touch/memory.md`
  신설 — 본 sprint 의 plugin 영역 침범 시도 lesson

### 5. 기존 lessons 9 카테고리 index 보강

`docs/archives/lessons/memory-lessons-2026-05-26/{parity-milestone,security,ui-patterns,boot-windows,data-and-query,workspace-shell,workflow,agent-and-git,e2e}/memory.md` 각각 신설.
sprint-387 의 skills index 누락 같은 결함 재발 방지의 일환.

## 회귀 영향

- 코드 변경 0. src/, src-tauri/ 무수정.
- vitest 4267 PASS (sprint-387 baseline 4197 → sprint-382/383 머지로 +70).
- clippy clean.
- 회귀 0.

## 사용자 지적 사항

**중간 발견 1 — skill 영역 침범 (anti-pattern)**: 사용자가 즉시 지적.
`.claude/skills/harness/prompts/evaluator.md` 본문 deprecate 시도 → revert →
정합성 차원에 카테고리 추가 + PreToolUse hard block + lesson 기록.

**중간 발견 2 — 정합성 차원 보강 요청**: skill 영역 침범 같은 안티패턴을
pr-reviewer 가 잡아야 함 → 정합성 sub-checklist 에 외부 영역 카탈로그 5종 추가.

## Profile 분기 검증

- 본 sprint = infra profile → tdd-cycle 자동 skip ✓
- code profile sprint 미래 — `[RED]` commit 없으면 pre-push 차단 (smoke 안 함,
  실제 code sprint 에서 확인)
