---
id: 0055
title: ERD 수동 링크 — 가상 FK 1급 모델 (polymorphic targets + discriminator 옵션)
status: Accepted
date: 2026-07-17
supersedes: null
superseded_by: null
---

**결정**: ERD 수동 링크를 그림 주석이 아닌 **가상 FK 1급 모델**로 저장한다 (2026-07-17, 오너). 형태: `{ source: (table, column), targets: [(table, column), ...], discriminator?: column }` — targets 복수 허용으로 polymorphic association(Rails-style `commentable_id` + `commentable_type`) 표현, discriminator 는 옵션 필드. 렌더: 실제 FK 와 시각 구분(점선 등 — 색 단독 인코딩 금지), polymorphic 은 한 source 컬럼에서 부챗살 엣지. 범위: ERD 표시 + 저장 + reconcile(ADR 0056)까지. **join 자동완성 연동은 명시적 비범위** — completion vocabulary 는 Rust/WASM 이 소유(ROADMAP 전략 제약)하고 discriminator 부재 시 join 대상이 모호해 별도 승격 결정이 필요하다.

**이유**: FK 제약 없는 실무 스키마(ORM 관례·polymorphic·레거시)에서 관계 시각화가 ERD 가치의 큰 몫. 그림으로 저장하면 reconcile/undo/export 가 일관되게 다룰 수 없어 1급 모델이 필요하다. targets 복수는 polymorphic 을 single-target 모델의 사후 개조 없이 처음부터 수용.

**트레이드오프**:
- **+** polymorphic 표현 가능 — single-target 모델로는 불가능한 실무 패턴 커버.
- **+** 후속 기능(naming-convention 관계 추론 제안, join 자동완성)의 데이터 기반 확보.
- **−** connection 별 persistence 와 스키마 변경 시 고아 링크 정리 비용(ADR 0056 reconcile 로 흡수).
- **−** discriminator 없는 가상 FK 는 join 의미 모호 — 자동완성 승격 전까지 표시 전용으로 방어.

**관련**:
- ADR 0054/0056/0057 — 같은 ERD 재설계 세트.
- `src/types/schemaGraph.ts` — 가상 FK 를 edge 확장으로 얹을 지점.
- naming-convention 관계 추론(`user_id`→`users.id`)은 결정적 휴리스틱 backlog — ML/AI 불요.
