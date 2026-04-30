---
id: "0019"
title: E2E를 CI에서 제거하고 lefthook pre-push(host-native)로 이동
status: Accepted
date: 2026-05-01
supersedes: "0015"
superseded_by: null
---

**결정**: GitHub Actions CI에서 `e2e` job(4-shard ubuntu-latest + Dockerfile.e2e + xvfb + WebKitGTK + tauri-driver)을 제거하고, e2e 검증을 개발자 host machine의 `lefthook` pre-push hook(`scripts/e2e-host.sh` → `pnpm test:e2e`)으로 이동한다. 사용자 환경(macOS WKWebView / Windows WebView2)과 동일한 native runtime에서만 검증한다. `--no-verify` / `LEFTHOOK=0` 회피는 `.claude/hooks/pre-bash.sh`에 dangerous-pattern으로 등록 및 `.claude/rules/git-policy.md`에 정책 명문화로 차단.

**이유**: Sprint 172~175에 걸친 CI e2e 안정화 시도(switchToWorkspaceWindow handle iteration, document.title 정렬, e2e 전용 tauri.e2e.conf.json overlay, buildx GHA + cargo target 캐싱, 4-shard 분할, mocha timeout 60s→120s + helper 15s→30s)에도 불구하고 ubuntu-latest에서의 cold-boot 지연이 비결정적으로 spec timeout 임계를 초과해 빨간 PR을 양산. Sprint 174 afterTest forensic dump(`wdio-report/*win0_aria.txt`)는 Workspace ARIA 트리(back button + public schema + tables 모두 `visible=true`)가 결국 mount됨을 입증해 **렌더 실패가 아닌 타이밍 실패**임을 확인. 누적 레이어(GHA shared runner → Docker → xvfb 가상 framebuffer → WebKitGTK 2.x → tauri-driver alpha → Tauri boot → 첫 DB connect)는 사용자가 실제로 사용하는 macOS WKWebView / Windows WebView2 스택과 무관 — Linux 빌드를 배포하지 않으므로 검증의 대표성도 없음. host-native 실행은 (a) 사용자 환경과 동일한 WebView, (b) xvfb/WebKitGTK/tauri-driver 부채 0, (c) docker daemon만 켜져 있으면 10여 초 boot로 안정적.

**트레이드오프**: 
- (+) CI 4-shard × 30분 timeout × 매 push로 누적되던 wall-clock + Actions minutes 비용 제거 (월 수십~수백 분 절감 추정).
- (+) 사용자 실제 환경(macOS WKWebView)과 동일한 stack에서만 검증 → 위양성/위음성 모두 감소.
- (+) `--no-verify` 차단으로 게이트 우회 불가 — Claude Code Bash hook + git policy doc 이중.
- (-) push 1회당 e2e 1회 실행 = 로컬 push latency가 cold start 시 1~3분 증가 (subsequent는 cargo incremental + e2e DB 컨테이너 재사용으로 30s~1분).
- (-) Linux 환경에서의 회귀를 push 게이트로 catch하지 못함 — 단 사용자가 Linux 빌드를 배포하지 않아 사실상 무위험. 향후 Linux 배포가 필요하면 별도 nightly `workflow_dispatch` job으로 분리.
- (-) docker daemon 미가동 / `pnpm` 미설치 등 host 부트스트랩 실패 시 push 자체가 막힘 — `scripts/e2e-host.sh`에서 actionable error 메시지 노출로 완화.
- (-) 다른 OS 협업자가 합류할 경우(예: Windows) host-native 흐름 재검증 필요 — 1인 개발 단계에서는 무위험, 2인 이상 진입 시 ADR 갱신.

**관련**: 
- Supersedes: ADR 0015 (e2e docker compose 표준화 — `pnpm test:e2e:docker`은 hook이 아닌 보조 진입점으로만 잔존).
- 관련 ADR: 0014(switchWindow), 0016(workspace.visible overlay), 0017(lazy workspace) — host-native 실행에서도 모두 그대로 적용.
- 보조 자료: `.claude/hooks/pre-bash.sh`(--no-verify/LEFTHOOK=0 차단), `.claude/rules/git-policy.md`(정책 명문).
