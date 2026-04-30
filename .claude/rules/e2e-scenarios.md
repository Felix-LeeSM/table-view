---
paths:
  - "e2e/**/*.spec.ts"
  - "e2e/_helpers.ts"
  - "e2e/cuj/**/*.ts"
---

# E2E 시나리오 설계 원칙 (자동 로드 stub)

이 파일은 e2e 작업 시 자동 로드되는 reminder 다.
**source of truth 는 [`memory/conventions/e2e-scenarios/memory.md`](../../memory/conventions/e2e-scenarios/memory.md)**
이며, 새 spec 작성·수정 전에 그 방을 먼저 읽는다.

## 핵심 8 원칙 요약 (전체는 memory 참조)

1. **테스트 피라미드** — e2e는 다중 컴포넌트+윈도우+IPC 결합 검증만. 단위 사실은 vitest로.
2. **spec = 사용자 의도 (여정)** — 화면별 it 묶음 금지, 한 it에서 직선적으로.
3. **CUJ 회귀 0%** — 5종(연결→첫쿼리, paradigm 전환, Home↔Workspace, 셀편집, 멀티윈도우 라이프).
4. **DBMS × paradigm 매트릭스** — PG 풀, Mongo 분기점만. 과조숙 추상화 금지.
5. **회귀 고정** — 사용자-가시 버그는 spec으로 박고 sprint/ADR 인용.
6. **`skip()`은 부채** — 만료 조건 없으면 추가 금지, stale skip 즉시 정리.
7. **tauri-driver 한계** — 강등 → selector 노출 → skip+이슈, 그 순서.
8. **진단성** — `step("...")` 라벨, afterTest 스크린샷, 한 줄 로그로 단계 식별 가능.

## 새 spec 추가 전 체크리스트

- [ ] vitest/component로 동등 검증 가능 → e2e에 두지 않는다
- [ ] CUJ 5종 중 하나 → `e2e/cuj/` 위치/태그
- [ ] 회귀 고정 → 상단 코멘트에 sprint/ADR 인용
- [ ] tauri-driver 한계 → P7 우선순위
- [ ] 모든 step에 `step("...")` 라벨
- [ ] 새 `skip()` → 만료 조건을 sprint handoff에 기록
