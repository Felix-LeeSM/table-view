---
title: e2e 복구는 invariant 변경 refactor sprint 의 prerequisite — vitest simulation 한 겹뿐
type: lesson
date: 2026-05-06
domain: e2e
adr: 0019 / 0020
sprint: 224 (검토 시점) / 225+ (deferred)
---

# 상황

post-209 cycle (Sprint 210–224) 종료 시점 e2e suite 가 사실상 dead.
`lefthook.yml:61-86` 의 `5_e2e: pnpm test:e2e:docker` 에 `skip: true`
(2026-05-01 부터). ADR 0019 (E2E 를 CI 에서 제거하고 pre-push 로 이동) +
ADR 0020 (host docker 한정, tauri-driver macOS 미지원) 가 현재는 작동 안
하는 상태. 12+ commit drift + spec ↔ UI 동기화 안 됨.

P10 step 3b/4 (persist 3 site / IPC bridge) 같은 invariant 변경 동반
refactor sprint 진입 시 검증 surface 가 `src/__tests__/cross-window-*.test.tsx`
의 vitest simulation 한 겹뿐. risk 가용 검증력 초과 → deferred.

# 원인

3 누적 원인:

1. **vite v6 production build OOM** in 4GB Docker container — main 원인.
   docker build 시 vite v6 가 메모리 spike. host docker 자원 (메모리
   할당) 또는 vite 설정 (chunk split / minify) 조정 필요.
2. **docker image staleness** — base image 갱신 안 됨. tauri-driver /
   sqlx 의존성 drift 가능.
3. **credentials drift (resolved)** — 과거 별도 이슈, 이미 해결됨.

ADR 0019 결정 시점에 e2e 가 pre-push 유일 게이트라는 invariant 가 명문
화됐으나, 실제로는 skip:true 상태가 5+ 일 지속되어 invariant 사실상 무
효. e2e 가 회귀 가드로 작동하지 않으면 cross-window 변동 sprint 의 안전
망이 vitest simulation 만 — IPC ordering / boot timing / OS event flush
순서 같은 real WKWebView 동작은 못 잡음.

# 재발 방지

- e2e suite 가 skip 상태로 N 일 지속되면 **PLAN.md 의 진행 가능 sprint
  scope 가 좁아짐을 명문화** — invariant 변경 없는 trivia (test split,
  god file 분해, helper extraction) 만 진입 가능, 행동 영향 sprint 는
  e2e 복구 prerequisite.
- e2e 복구 sprint 분해:
  1. vite v6 build OOM 원인 분석 (`pnpm build` 메모리 프로파일 + chunk
     split 검토 + node `--max-old-space-size`).
  2. docker image rebuild + base image 버전 고정 (commit lock).
  3. 12+ commit drift catch-up (UI 변경에 따른 spec selector 갱신).
  4. lefthook 5_e2e `skip:true` 제거 + dry-run 1회.
- e2e 복구 sprint 가 invariant 변경 sprint (P10 step 3b/4 / Phase 28)
  보다 우선순위 높음을 PLAN sequencing 표 / refactoring-candidates 에
  prerequisite 로 명시.
- 근본 대안 = e2e 외 invariant 검증 surface 추가 (real WKWebView headless
  smoke / Tauri integration test). 단 ADR 추가 + crate / 도구 선정 필요.
