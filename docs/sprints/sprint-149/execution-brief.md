# Sprint 149 — Execution Brief

## Objective

AC-141-* lifecycle invariants를 single-window 위에서 회귀 테스트로 잠그고,
실제 Tauri 윈도우 분리는 phase 12로 이월한다. 이월은 ADR + RISKS.md +
`it.todo()` + findings의 4중 강제 메커니즘으로 미래 구현을 강제한다.

## Task Why

Sprint 149의 spec(별도 launcher / workspace Tauri 윈도우)은 한 sprint
작업 단위를 초과한다 — 5개 store에 IPC 동기화, tauri.conf.json 재정의,
Rust 측 launcher module 신설, 모든 e2e 재작성이 동시에 필요하다. spec의
**사용자 관측 가능한 lifecycle invariants** (boot 시 launcher, 활성화 시
workspace 진입, Back 시 launcher 복귀하면서 pool 유지, Disconnect는 pool
eviction)는 single-window screen toggle 모델 위에서도 의미가 보존된다.
회귀 테스트로 이 invariants를 잠그고 실제 윈도우 분리는 별도 phase에서
다룬다.

## Scope Boundary

- 실제 윈도우 생성 / tauri.conf.json 손대지 않는다.
- WorkspacePage / HomePage / DisconnectButton의 동작 변경 없다.
- 새 e2e 시나리오 추가하지 않는다.

## Invariants

- 2239 기존 테스트 + 신규 테스트가 모두 green.
- "Back to connections" 클릭은 `disconnectFromDatabase`를 호출하지 **않는다**
  (pool 유지 핵심).
- DisconnectButton 클릭은 pool eviction까지 수행한다 (Sprint 148 invariant).

## Done Criteria

1. 신규 테스트 파일이 AC-141-1/2/3/4/5 5개에 매핑되는 `it()` 블록 + phase 12
   real-window invariants `it.todo()` 5개를 가지고 모두 통과.
2. ADR 0011 작성 + 인덱스 업데이트.
3. RISKS.md에 RISK-025 추가.
4. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 exit 0.

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`.
- Required evidence: 변경 파일 manifest, AC↔테스트 매핑 표, todo 카운트
  변화 (이전 N → 이후 N+5), ADR 0011 링크, RISK-025 라인 인용.

## Evidence To Return

- 변경 파일 + 목적.
- 명령 출력 (3종).
- AC↔테스트 매핑 표 (실 it 5개 + todo 5개).
- 강제 메커니즘 4중 잠금 위치 (ADR / RISKS / todo / findings).
- 가정/리스크/이월: 별도 윈도우 미생성 사유, phase 12 진입 트리거.
