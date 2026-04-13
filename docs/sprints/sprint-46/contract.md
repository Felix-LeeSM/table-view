# Sprint Contract: Sprint 46

## Summary

- Goal: Dialog/Modal 통합 — 수작성 모달을 shadcn Dialog로 전환
- Audience: Generator / Evaluator
- Owner: Harness Orchestrator
- Verification Profile: `command`

## In Scope

- ConfirmDialog를 shadcn Dialog 기반으로 재구현
- ConnectionDialog를 shadcn Dialog 기반으로 재구현
- StructurePanel의 3개 인라인 모달(SqlPreview, CreateIndex, AddConstraint)을 shadcn Dialog로 전환
- DataGrid의 SQL Preview 모달을 shadcn Dialog로 전환
- SchemaTree의 인라인 모달(테이블 삭제 확인, 이름 변경)을 shadcn Dialog로 전환
- ConnectionItem의 삭제 확인 모달을 shadcn Dialog로 전환
- QuickOpen의 오버레이를 shadcn Dialog로 전환

## Out of Scope

- 모달 내부의 폼 로직/비즈니스 로직 변경
- shadcn Input/Select/Button 프리미티브 적용 (Sprint 49)
- DataGrid 분해 (Sprint 47)
- StructurePanel 분해 (Sprint 48)
- CSS 변수 전환

## Invariants

- 기존 707 테스트 모두 통과
- `pnpm build` 성공
- `pnpm tsc --noEmit` 통과
- `pnpm lint` 에러 0건
- 모든 모달의 기능(열기/닫기, 폼 제출, 확인/취소)이 기존과 동일
- Rust 백엔드 변경 없음

## Acceptance Criteria

- `AC-01`: ConfirmDialog가 shadcn AlertDialog를 사용하며, 기존의 title/message/onConfirm/onCancel 인터페이스가 동일하게 동작함
- `AC-02`: ConnectionDialog가 shadcn Dialog를 사용하며, 연결 생성/편집 플로우가 기존과 동일함
- `AC-03`: StructurePanel의 인라인 모달들이 shadcn Dialog를 사용함
- `AC-04`: DataGrid의 SQL Preview 모달이 shadcn Dialog를 사용함
- `AC-05`: SchemaTree의 인라인 모달들이 shadcn Dialog를 사용함
- `AC-06`: `grep -r "fixed inset-0 z-50" src/components/` 결과가 0건 (모든 수작성 모달 오버레이 제거)
- `AC-07`: `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm build`, `pnpm lint` 모두 통과

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 체크
2. `pnpm vitest run` — 전체 테스트
3. `pnpm build` — 빌드
4. `pnpm lint` — 린트
5. `grep -r "fixed inset-0 z-50" src/components/` — 수작성 모달 오버레이 제거 확인

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - grep 결과 (수작성 모달 제거 증명)

## Test Requirements

### Unit Tests
- 기존 모달 테스트가 모두 통과해야 함
- 새로운 테스트 불필요 (기존 테스트로 동작 검증 충분)

## Test Script / Repro Script

1. `pnpm tsc --noEmit`
2. `pnpm vitest run`
3. `pnpm build`
4. `pnpm lint`
5. `grep -rn "fixed inset-0" src/components/ | grep -v ".test."`

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- No remaining inline modal overlays
