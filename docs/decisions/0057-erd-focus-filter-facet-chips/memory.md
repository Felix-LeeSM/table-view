---
id: 0057
title: ERD 포커스 필터 — facet 칩 (facet 내 OR / facet 간 AND), boolean builder 기각
status: Accepted
date: 2026-07-17
supersedes: null
superseded_by: null
---

**결정**: ERD 포커스 모드 필터 = **facet 칩 모델** (2026-07-17, 오너). facet 종류 3: schema / table / "선택 테이블 + N-hop 이웃". 같은 facet 내 다중 칩 = OR, facet 간 = AND — 예: `(schema A OR B) AND (users + 2-hop)`. 임의 중첩 AND/OR boolean builder 는 기각.

**이유**: 대형 스키마에서 전체 그래프는 어떤 레이아웃도 못 살림 — 포커스 모드가 실사용성 핵심이라 빨리 배송돼야 한다. facet 칩이 실사용 시나리오 대부분을 덮으면서 UI·a11y 비용이 낮다. 임의 중첩 빌더는 그룹핑/괄호/우선순위 UI 복잡도 폭탄.

**트레이드오프**:
- **+** 단순 UI, 낮은 구현·a11y 비용. 칩 모델은 boolean builder 의 부분집합이라 수요 확인 시 승격 가능.
- **−** 교차 facet OR(`schema A OR table X`) 표현 불가 — 수요 확인 전까지 수용.

**관련**:
- ADR 0054 — semantic zoom·가상화와 함께 대형 스키마 실사용 3종 세트.
