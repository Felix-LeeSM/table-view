---
sprint: 388
title: Review Infrastructure — Handoff
date: 2026-05-18
---

# Sprint 388 — Handoff

review pipeline 인프라 구축 완료. 자동 layer (hook / lint / script) + 정성
layer (pr-reviewer agent 1 spawn). 다음 PR 부터 본 룰 적용.

## 적용 후 동작

### 새 sprint 작성 시

1. `docs/sprints/sprint-<N>/contract.md` frontmatter 에 `review-profile:
   code | security | infra | docs` 추가 (없으면 pr-reviewer 가 기본 매트릭스
   적용, 단 TDD 등 자동 검사 영향).
2. "Required Checks" 섹션 numbered list 의 백틱 명령은 `scripts/review/
   run-checks.sh` 가 batch 실행.

### PR 생성 시

1. agent A (구현) 가 commit + push + `gh pr create`.
2. pre-commit / pre-push hook 자동 실행 (회귀 / TDD / ADR 동결 / coverage).
3. PR check (GitHub Actions) 자동 실행 — 동일 lint / test.
4. agent A 가 `pr-reviewer` agent spawn:
   - pr-reviewer 가 `memory/workflow/review/memory.md` read
   - contract `review-profile` 추출
   - `scripts/review/run-checks.sh <N>` 실행 (자동 layer 결과 입력)
   - 정성 3 차원 평가 → scorecard PR comment 게시
5. 자율 머지 조건 (정성 ≥ 7/10 모두 + CI green + 사용자 거부 없음) →
   `gh pr merge --squash --delete-branch`.

### Hard block 동작

| 동작 | 차단 |
|---|---|
| `.claude/skills/<x>/` 수정 | PreToolUse Edit|Write wrapper cap / source 분리 확인 |
| `.env*`, `.claude/settings.local.json` 수정 | PreToolUse hard block (기존) |
| ADR 본문 수정 | pre-commit `adr-frozen` (frontmatter 메타만 허용) |
| `git push --force` (사용자 미승인) | Bash PreToolUse `check-dangerous-bash` |
| `--no-verify` / `LEFTHOOK=0` | Bash PreToolUse (sprint-387) |
| code profile sprint 의 RED commit 누락 | pre-push 8 stage |
| wrapper 줄수 cap 초과 | PostToolUse (warn) — agent 보고 fix |
| memory/ index 누락 | PostToolUse (warn) |

## 미래 작업 (deferred)

| ID | 작업 | 근거 |
|---|---|---|
| D1 | Codex / Cursor 의 pr-reviewer wrapper 형식 | sprint-387 deferred 와 동일 — multi-brain 확장 |
| D2 | coverage threshold 의 sprint-별 dynamic 조정 | lefthook 정적 값 유지, 본 sprint scope 외 |
| D3 | run-checks.sh 의 markdown 변종 파서 (다-line 명령, 백틱 없는 명령) | best-effort 현재, 후속 보강 |
| D4 | profile 추가 (예: `ux`, `data-migration`) — 매트릭스 확장 시 | 실제 필요 시 |
| D5 | pr-reviewer 의 codex 외부 리뷰 자동 spawn (현재 사용자 명시 시만) | 정책 변경 시 |
| D6 | 자동 머지 조건의 사용자 거부 detection — Stop hook + `git rev-parse` 의 차이로 거부 추적? | 정책 명확화 후 |
| D7 | review-profile 누락 시 PR template / lefthook 경고 | 점진 강제 |
| D8 | harness skill 의 `evaluator` prompt 가 본 repo 의 pr-reviewer 패턴 (2층 + lazy + profile) 처럼 진화 — plugin upstream PR / fork 옵션. **본 repo 가 skill 영역 수정 금지 원칙은 유지**. | 사용자 의지 표명 (sprint-388) |

## Sprint-387 deferred (sprint-388 영향 항목)

| ID | 상태 |
|---|---|
| sprint-387 D1 (Codex wrapper) | 미진행 — sprint-388 도 같은 deferred |
| sprint-387 D2 (Cursor wrapper) | 미진행 |
| sprint-387 D3 (R2 자동 derive) | 미진행 — sprint-388 의 5 hook script 가 manual derive 첫 사례. R2 자동화는 별 sprint |
| sprint-387 D6 (god file 43개) | 미진행 |
| sprint-387 D7 (frontmatter retrofit) | 부분 — review-profile 신설로 frontmatter 1 필드 추가 |

## 운영 룰

- review 룰 source: `memory/workflow/review/memory.md` 단일. wrapper / agent
  prompt 가 본 방을 가리킴.
- `.claude/skills/<x>/` 는 thin wrapper 만 — skill source 는 `.agents/skills/<x>/`.
- hook script 의 anchor / 패턴 결함 발견 시 lesson 기록 + script fix (sprint-
  387 의 bash-c bypass 와 동일 패턴).
- contract frontmatter 의 `review-profile` 누락 시 pr-reviewer 가 기본 매트릭스
  적용. 단 명시 권장 (보고서 noise 감소).

## 다음 시점 검증 항목

- code profile sprint 실제 사용 시 — `[RED]` commit 강제 동작 확인.
- pr-reviewer agent 가 정성 3 차원 + profile 분기 정확히 적용하는지 PR comment
  품질 점검.
- `.claude/skills/<x>/` wrapper 가 15줄 cap 을 넘지 않는지 확인.
- `scripts/review/run-checks.sh` 의 contract 파서가 실제 sprint contract 들의
  Required Checks 섹션을 일관되게 처리하는지 확인 (현재 sprint-388 contract
  로 smoke 만).
