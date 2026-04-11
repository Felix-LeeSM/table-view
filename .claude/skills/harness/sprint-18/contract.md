# Sprint Contract: Sprint 18

## Summary

- Goal: CI E2E 잡 추가 + DB 연결 플로우 E2E 테스트 작성
- Audience: Generator / Evaluator
- Owner: Orchestrator
- Verification Profile: `command`

## In Scope

1. `.github/workflows/ci.yml` — e2e 잡 추가 (webkit2gtk-driver, xvfb, tauri-driver, PG service)
2. `e2e/connection.spec.ts` — DB 연결/스키마 조회 E2E 테스트 (신규)
3. `scripts/setup-e2e.sh` — 로컬 E2E 환경 안내 스크립트 (신규)

## Out of Scope

- 프로덕션 코드에 data-testid 추가
- 쿼리 실행 E2E (CodeMirror 타이핑 복잡)
- 로컬 E2E 실행 환경 자동 구축

## Invariants

- 기존 376 frontend + 84 Rust lib 테스트 통과
- 기존 integration 테스트 통과
- 프로덕션 코드 변경 없음
- pnpm lint, pnpm tsc --noEmit 통과

## Acceptance Criteria

- AC-01: `.github/workflows/ci.yml`에 e2e 잡 존재 (webkit2gtk-driver, xvfb, tauri-driver, PG service)
- AC-02: CI e2e 잡이 xvfb-run pnpm test:e2e 실행
- AC-03: `e2e/connection.spec.ts`가 "New Connection" 버튼 → 폼 작성 → Save 플로우 테스트
- AC-04: `e2e/connection.spec.ts`가 더블클릭 → 연결 → "public" 스키마 표시 플로우 테스트
- AC-05: `scripts/setup-e2e.sh` 존재
- AC-06: 기존 테스트 영향 없음

## Selector Reference (실제 코드 기반)

- New Connection 버튼: `[aria-label="New Connection"]`
- 폼 입력: `#conn-name`, `#conn-host`, `#conn-port`, `#conn-user`, `#conn-password`, `#conn-database`
- Save 버튼: 텍스트 "Save"
- Cancel 버튼: 텍스트 "Cancel"
- 연결 항목: ConnectionItem에 name 텍스트
- 스키마 항목: `[aria-label="public schema"]`
- 다이얼로그: `[role="dialog"]`

## Verification Plan

### Required Checks

1. `pnpm lint && pnpm tsc --noEmit` — clean
2. `pnpm vitest run` — 376 pass
3. `cargo test --lib` — 84 pass
4. CI yml 문법 유효 (정적 검증)
5. e2e/connection.spec.ts 파일 존재

## Ownership

- Generator: Sprint 18 Generator
- Write scope: `.github/workflows/ci.yml`, `e2e/connection.spec.ts`, `scripts/setup-e2e.sh`
- Merge order: direct to main

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
