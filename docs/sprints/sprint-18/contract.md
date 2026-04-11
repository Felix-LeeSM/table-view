# Sprint Contract: Sprint 18

## Summary

- Goal: 활성 residual risk를 단일 문서(docs/RISKS.md)로 정리하여, 향후 스프린트 handoff를 재읽기할 필요 없이 risk 상태를 추적할 수 있도록 함
- Audience: Generator (문서 작성), Evaluator (정적 검증)
- Owner: Orchestrator
- Verification Profile: `static`

## In Scope

- docs/RISKS.md 파일 생성
- 스프린트 0-17의 모든 residual risk 수집 및 분류
- 해결됨/활성/지연 상태 태깅
- 영역(owner/area) 태깅 (backend, frontend/testing, infra, ci)
- Resolution Log 섹션 포함

## Out of Scope

- risk 자체의 해결 (이번 스프린트는 문서화만)
- Phase 4 기능 구현
- 기존 코드 변경

## Invariants

- 기존 소스 코드 변경 없음
- 기존 테스트 회귀 없음
- CLAUDE.md, PLAN.md 내용 변경 없음

## Acceptance Criteria

- `AC-01`: docs/RISKS.md 파일이 존재하며, ID/설명/상태/영역태그/출처스프린트/해결노트 구조를 갖춤
- `AC-02`: 수집된 12개 잔여 위험이 모두 문서에 포함됨
- `AC-03`: 이후 스프린트에서 해결된 항목(fetchData 경쟁조건, loadTables 상태누수 등)이 `resolved`로 표시되고 해결 스프린트가 명시됨
- `AC-04`: 각 위험에 비어있지 않은 영역 태그가 지정됨 (backend, frontend/testing, infra, ci 등)
- `AC-05`: 문서에 "해결 로그" 섹션이 포함되어, 해결된 위험의 이력을 삭제 없이 추적 가능

## Design Bar / Quality Bar

- 모든 위험 항목이 중복 없이 고유 ID로 식별 가능
- 마크다운 테이블 형식으로 가독성 확보
- 기존 스프린트 handoff의 risk 섹션 참조가 필요 없을 정도로 완전한 단일 소스

## Verification Plan

### Required Checks

1. `docs/RISKS.md` 파일 존재 확인
2. 문서 내 12개 위험 항목 모두 포함 확인 (텍스트 검색)
3. 해결된 위험이 `resolved` 상태로 표시되었는지 확인
4. 각 위험에 영역 태그가 있는지 확인
5. Resolution Log 섹션 존재 확인

### Required Evidence

- Generator must provide:
  - 생성된 docs/RISKS.md 파일 경로
  - 포함된 위험 항목 수
  - 각 상태별(active/resolved/deferred) 항목 수
- Evaluator must cite:
  - 파일 내용 검증 결과
  - 누락된 위험 항목이 있는지
  - 구조적 완전성 평가

## Test Requirements

정적 문서 작업이므로 단위 테스트 불필요.

## Test Script / Repro Script

1. `cat docs/RISKS.md` — 파일 내용 확인
2. `grep -c "RISK-" docs/RISKS.md` — risk 항목 수 확인
3. `grep "resolved" docs/RISKS.md` — 해결됨 항목 확인

## Ownership

- Generator: Agent
- Write scope: docs/RISKS.md only
- Merge order: 단일 파일, 순서 무관

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in handoff.md
