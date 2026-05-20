---
id: "0044"
title: E2E smoke — remote PR/main blocking check
status: Accepted
date: 2026-05-20
supersedes: "0019, 0020"
---

**결정**: `e2e/smoke/**` WebdriverIO + tauri-driver smoke 는 GitHub Actions
remote check 로 PR 과 `main` push 에서 실행하고, 실패 시 workflow 를 실패시킨다.
로컬 pre-push 는 정적/단위/통합 게이트를 유지하되 runtime smoke 의 source of
truth 는 `.github/workflows/e2e-smoke.yml` 이다.

**이유**:

1. PR merge 판단은 remote CI 결과를 기준으로 한다. e2e smoke 가 PR 에서
   실행되지 않거나 advisory 면 실제 앱 부팅 회귀가 merge 전에 보장되지 않는다.
2. 현재 smoke suite 는 full-suite e2e 가 아니라 PG/Mongo happy path 두 축이다.
   비용은 크지만 PR gating 으로 감당 가능한 범위이고, 실패 artifact 도
   `e2e/wdio-report/` 로 수집된다.
3. 로컬 hook 은 환경 차이가 크고 우회 방지 정책에 의존한다. remote blocking
   check 는 GitHub 의 merge/check surface 에 같은 신호를 노출한다.

**트레이드오프**:

- **+** PR 에서 실제 Tauri 앱 부팅, DB seed, PG/Mongo smoke 가 실패하면 merge
  전에 빨간 check 로 드러난다.
- **+** `main` push 에서도 동일 smoke 가 돌아 merge 후 tip 상태를 확인한다.
- **−** PR CI 시간이 증가한다. smoke 는 full-suite 가 아니라 최소 happy path
  로 제한하고, Rust/tauri-driver cache 를 유지해 비용을 관리한다.
- **−** Linux WebKitGTK + tauri-driver 스택의 flake 가능성이 다시 PR gate 에
  들어온다. flake 는 advisory 로 숨기지 않고 원인 분석 대상이 된다.

**관련**:

- Supersedes ADR 0019, ADR 0020.
- `.github/workflows/e2e-smoke.yml`
- `scripts/e2e-smoke-ci.sh`
- `wdio.smoke.conf.ts`
