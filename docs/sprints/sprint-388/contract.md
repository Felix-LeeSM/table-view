---
sprint: 388
title: review infra — 자동 layer + 정성 evaluator + profile 분기
date: 2026-05-18
owner: orchestrator
status: in_progress
review-profile: infra
---

# Sprint 388 Contract — Review Infrastructure

## Goal

sprint-387 의 lazy multi-agent 인프라 위에 **PR review pipeline** 신설. 정량은
hook / lint / script 가 자동, 정성 3 차원 (Mock 범위 / 정합성 / Sprint contract
scope) 만 evaluator agent 가 평가. agent spawn = PR 당 1회.

## Scope

### In scope

1. **`memory/workflow/review/memory.md` 신설** — review 룰 source. 차원 정의 +
   profile 매트릭스 + 자동/정성 분리 + 출력 형식 + delivery 통합.
2. **`scripts/check-memory-structure.sh` 보강** — 자식 디렉토리 있는데 본인에
   index `memory.md` 없으면 fail (sprint-387 의 skills index 누락 결함 차단).
3. **`scripts/check-wrapper-cap.sh` 신설** — `.claude/agents` ≤ 15 /
   `.claude/rules` ≤ 20 / `.claude/commands` ≤ 15 줄 cap. README.md 는 skip.
4. **`scripts/check-tdd-cycle.sh` 신설** — code profile sprint 만 검사.
   `origin/main..HEAD` 에 `[RED]` / `RED:` / `test.*fail` commit 없으면 fail.
5. **`scripts/check-adr-frozen.sh` 신설** — `memory/decisions/*/memory.md` 의
   frontmatter (`---` 사이) 외 hunk 차단. 새 ADR 은 OK.
6. **`scripts/review/run-checks.sh` 신설** — `docs/sprints/sprint-<N>/contract.md`
   의 "Required Checks" 섹션 numbered list 파싱 → 백틱 안의 명령 batch 실행 →
   PASS/FAIL list 출력.
7. **lefthook + settings.json 연결**:
   - `pre-commit` 에 `check-adr-frozen.sh` 추가
   - `pre-push` 에 `check-tdd-cycle.sh` 추가 (review-profile 추출 후 실행)
   - `.claude/settings.json` PostToolUse Edit|Write 에 `check-wrapper-cap.sh`
     추가 (`.claude/{agents,rules,commands}/*.md` 매치)
8. **`.claude/agents/evaluator.md` 갱신** — read 리스트 교체:
   - `memory/workflow/review/memory.md` (신규 source)
   - 대상 sprint contract.md (review-profile 추출)
   - `bash scripts/review/run-checks.sh <sprint>` 출력 (자동 layer 결과 입력)
9. **`memory/workflow/delivery/memory.md` 갱신** — T4 review step 명시:
   - evaluator spawn 1회 (default)
   - codex-reviewer 사용자 명시 시만
   - 자율 머지 조건: 정성 ≥ 7/10 + CI green + 사용자 거부 없음
10. **harness skill 분리** — `.claude/skills/harness/prompts/evaluator.md` 는
    skill plugin 영역으로 **건드리지 않음**. 본 sprint 의 evaluator 룰
    (`memory/workflow/review/memory.md`) 은 repo 자체 source, harness skill 의
    evaluator prompt 와 직교 — 두 룰 독립 진화.

### Out of scope (deferred)

- 외부 brain (Codex / Cursor) 용 evaluator wrapper — 본 sprint 는 Claude Code
  의 evaluator 만 갱신. Codex 호환은 별 sprint.
- run-checks.sh 의 contract 파서가 markdown 의 변종 (예: 백틱 없는 명령, 다
  -line 명령) 대응 — best-effort. 후속 sprint 에서 보강.
- coverage threshold 의 sprint-별 dynamic 조정 — lefthook 의 정적 값 유지.

## Invariants

- 기존 7 stage pre-push 동작 보존. 새 stage 추가만 (회귀 없음).
- 기존 hook scripts 호출 경로 unchanged.
- `memory/` 트리는 여전히 `memory.md` 만. 신설 디렉토리에 index 포함.
- evaluator agent frontmatter (`name`, `tools`, `model`) 보존.
- `.claude/skills/harness/prompts/evaluator.md` 는 deprecate 만 — 삭제 X
  (sprint-386 의 다른 prompt 들과 패턴 통일).

## Acceptance Criteria

- `AC-388-01` `memory/workflow/review/memory.md` 존재, ≤ 200줄, 3 정성 차원 +
  profile 매트릭스 명시.
- `AC-388-02` `scripts/check-memory-structure.sh` 가 자식 디렉토리 있는데 본인
  index 없으면 exit 1. (smoke: `mkdir -p /tmp/test-mem/child && touch
  /tmp/test-mem/child/memory.md` + 본 dir 에 memory.md 없으면 fail.)
- `AC-388-03` `scripts/check-wrapper-cap.sh` smoke — `.claude/agents/*.md` 모두
  ≤ 15 줄 (현재 통과). 16줄 fixture 생성 시 exit 1.
- `AC-388-04` `scripts/check-tdd-cycle.sh` smoke — code profile + RED commit
  없음 fixture → exit 1, code profile + RED 있음 → exit 0, infra profile →
  exit 0 (skip).
- `AC-388-05` `scripts/check-adr-frozen.sh` smoke — 기존 ADR 의 본문 hunk
  staged 시 exit 1, frontmatter 만 staged 시 exit 0, 새 ADR (untracked) 시
  exit 0.
- `AC-388-06` `scripts/review/run-checks.sh 388` 호출 시 본 contract 의
  Required Checks list 명령들 실행 + PASS/FAIL list 출력.
- `AC-388-07` `lefthook.yml` pre-commit 에 `check-adr-frozen` stage 추가.
- `AC-388-08` `lefthook.yml` pre-push 에 `8_check-tdd-cycle` stage 추가
  (review-profile 추출 후 호출).
- `AC-388-09` `.claude/settings.json` PostToolUse Edit|Write 에
  `check-wrapper-cap.sh` 호출 등록 (`.claude/{agents,rules,commands}/*.md`
  매치).
- `AC-388-10` `.claude/agents/evaluator.md` ≤ 15 줄, read 리스트가 새 source
  3개.
- `AC-388-11` `memory/workflow/delivery/memory.md` T4 review step 갱신 +
  자율 머지 조건 명시.
- `AC-388-12` `.claude/skills/harness/prompts/evaluator.md` unchanged (skill
  plugin 영역 분리, 본 sprint 가 손대지 않음).
- `AC-388-13` `bash scripts/check-memory-structure.sh` exit 0 (본 sprint 후
  포함).
- `AC-388-14` `bash scripts/check-wrapper-cap.sh` exit 0.
- `AC-388-15` `pnpm tsc --noEmit` clean.
- `AC-388-16` `pnpm lint` 0 errors.
- `AC-388-17` `pnpm vitest run` PASS (baseline 4197+).
- `AC-388-18` `cargo clippy --all-targets --all-features -- -D warnings` clean.

## Design Bar / Quality Bar

- 코드 변경 0 (src/ src-tauri/ 무수정). 본 sprint 는 review 인프라.
- TDD 적용 안 함 — 인프라 sprint, smoke test 로 script 동작 검증.
- 모든 신설 script bash + POSIX 호환 + executable.
- caveman 톤.

## Verification Plan

### Required Checks

1. `wc -l memory/workflow/review/memory.md` ≤ 200
2. `bash scripts/check-memory-structure.sh`
3. `bash scripts/check-wrapper-cap.sh`
4. `bash scripts/check-adr-frozen.sh` (no diff 시 exit 0)
5. `bash scripts/review/run-checks.sh 388`
6. `pnpm tsc --noEmit`
7. `pnpm lint`
8. `pnpm vitest run`
9. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`

### Required Evidence

- 5 hook script smoke 출력 (fixture pass/fail)
- lefthook + settings.json hook 등록 diff
- evaluator wrapper diff
- PR URL

## Ownership

- Generator: orchestrator
- Write scope: In Scope 10 항목
- Merge order: 사용자 확인 후 squash. 본 sprint 는 자율 머지 가능 (사용자
  옵션) — review profile 적용 시 본인 review 가 self-eval 편향 → 사용자
  확인 권장.

## Exit Criteria

- AC 18/18 PASS
- 사용자 PR 리뷰 통과 또는 자율 머지 명시
- handoff.md 에 Codex evaluator / coverage dynamic threshold deferred 명시
