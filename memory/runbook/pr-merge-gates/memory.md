---
title: PR merge 게이트 진단 / 처리
type: runbook
updated: 2026-07-10
task: merge, pr, review-gate, ci, blocked, ruleset, e2e
trigger:
  signal: PR 이 mergeable 인데 mergeState=BLOCKED / merge 가 base branch policy 로 거부
  layer: agent-prompt (delivery agent)
---

# PR merge 게이트 진단 / 처리

`gh pr merge` 가 BLOCKED / "base branch policy prohibits" 로 막힐 때 원인 규명 순서.
label 메커니즘 자체는 [delivery](../../workflow/delivery/memory.md) (T5/T6) 소유 —
본 방은 **required 게이트의 숨은 위치와 잘못된 대응이 만드는 함정**만 다룬다.

## Required 게이트는 두 곳에 분산 (핵심)

1. **legacy branch protection** — `review-gate` 하나.
   `gh api repos/{o}/{r}/branches/main/protection/required_status_checks` 로 보임.
2. **repository ruleset `pr_to_main`** — 8개: `Frontend Checks` /
   `Rust Unit And Storage Tests` / `Integration Tests (Docker)` / `Runtime Happy Path` /
   `Dependency Security` (2026-07-05 1차) / `Rust Static Analysis` / `PR Body Contract` /
   `Detect Change Scope` (2026-07-10 2차 — 셋 다 무조건 실행 + 40여 PR green 관측 근거로
   일괄 등록, 소유자 확정).
   ★ protection API 에 **안 나온다**. `gh api repos/{o}/{r}/rulesets/<id>` 또는
   `gh pr merge <n> --admin` 의 에러 메시지로만 확인된다.
   (2026-07-03 #1183 delivery 실측 — 이전 서술 "E2E 만" 은 불완전했음.)
   2차 등록분 fail 도 이제 BLOCKED 다 — 대응은 fix (PR body 정정 / clippy fix) 지 회피 아님.

→ protection API 만 보고 "required 는 review-gate 뿐" 이라 단정하지 말 것. E2E 가 진짜
blocker 인 경우가 많다 (docs/hook 변경이어도 ruleset 이 E2E 를 요구).

## 잘못된 대응이 만드는 함정

- **트리거 반복 금지**: `gh run rerun`(review-gate) / label remove→add 반복 /
  `gh pr update-branch` 를 섞으면 head SHA 에 review-gate check-run 이
  fail·cancelled·success 로 뒤섞여 쌓이고, 최신이 success 여도 GitHub 이 required
  판정을 못 풀어 BLOCKED 가 고착된다. review-gate 는 `labeled` 이벤트에서만 success 를
  내고 opened/synchronize/rerun 은 fail run 을 남긴다.
- **update-branch(main pull) 불필요**: branch protection `strict`(up-to-date)=false →
  behind 여도 merge 된다. update-branch 는 synchronize 이벤트로 `review:approved` 를
  떨구기만 하고 이득 없음.
- **CLEAN 만 기다리지 말 것**: `mergeState=UNSTABLE` = required 전부 pass +
  non-required 만 fail → **merge 가능**. ※ `Dependency Security`(cargo deny / RUSTSEC)는
  2026-07-05 부터 **required 로 승격** — fail 이면 BLOCKED. RUSTSEC 신규 advisory 로
  본 변경과 무관하게 막힐 수 있다 → 그 경우 회피가 아니라 advisory 대응(버전 bump /
  deny.toml 예외 + 근거 주석)이 fix 다.

## 올바른 순서

1. 리뷰 green 확보 → CI 를 자연히 다 돌게 둔다 (트리거 추가 X).
2. **맨 마지막에** `review:approved` label 부착 (labeled → review-gate success).
   그 뒤로 push/rerun/update-branch 로 SHA·run 을 건드리지 않는다.
3. E2E flaky fail 은 workflow run 완료 후 `gh run rerun <id> --failed` 1회.
4. `mergeState` 가 `UNSTABLE` 또는 `CLEAN` 이 되면 `gh pr merge`.
   (`--admin` 은 `enforce_admins=true` + ruleset 이라 우회 불가 — required 를 실제로
   충족시켜야 한다.)

## 진단 명령

- `gh pr view <n> --json mergeable,mergeStateStatus` — BLOCKED/UNSTABLE/CLEAN 판별
- `gh pr checks <n>` 에서 `Runtime Happy Path` 상태 + `review-gate` 확인
- `gh api .../commits/<headSha>/check-runs` — review-gate run 이 여러 개 쌓였는지

## Why

2026-07-02 세션: 4개 fix PR merge 시 review-gate 에만 집착해 rerun/label토글/
update-branch 를 반복 → run 이 쌓여 수십 분 BLOCKED 고착. 실제 blocker 는 ruleset 의
E2E 였고 protection API 에 안 보여 뒤늦게 `--admin` 에러로 발견. UNSTABLE 을 merge 가능
상태로 인지 못해 추가 지연.

## How to apply

merge 막히면 위 "두 곳 분산" → "함정" → "올바른 순서" 순으로 점검. 이미 run 이 엉켰으면
빈 commit 으로 SHA 리셋보다 **트리거를 멈추고** UNSTABLE 로 안착하길 기다린 뒤 merge.

## 관련

- [delivery](../../workflow/delivery/memory.md) — T4~T7, review-gate label / enforce_admins 계약
- [worktree](../worktree/memory.md) — merge 후 worktree cleanup
- `.claude/rules/git-policy.md` — hook 회피 / force push 금지
