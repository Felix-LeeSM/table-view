---
id: 0054
title: ERD 캔버스 — React Flow(@xyflow/react) + elkjs layered 채택, 수제 렌더러 대체
status: Accepted
date: 2026-07-17
supersedes: null
superseded_by: null
---

**결정**: ERD 캔버스 기반을 수제 SVG 렌더러(`SchemaErdRenderer.tsx` 687줄 + `SchemaErdLayout.ts` 고정 3열 그리드)에서 `@xyflow/react`(React Flow) + `elkjs` 로 교체한다 (2026-07-17, 오너). 세부 결정 6: (1) 자동 배치 = elkjs `layered` — FK 방향 rank(참조되는 테이블이 위층), barycenter 교차 최소화, in-degree 높은 허브 테이블 node priority. FK 그래프의 순환/self-reference 는 layered cycle-breaking 으로 처리. (2) semantic zoom 3단계 — 원거리: 테이블 박스만 / 중간: PK·FK 컬럼만 / 근접: 전체 컬럼. 고정 `MAX_RENDERED_COLUMNS=6` 정책 폐기. (3) viewport 가상화 — 화면 밖 노드 미렌더(React Flow 내장), elkjs 레이아웃 계산은 web worker. (4) multi-schema 는 flat 캔버스 — `schema.table` qualified name + 스키마별 뱃지/색. 그룹 컨테이너 기각(cross-schema FK 가 자연스럽고, 스코핑은 ADR 0057 포커스 필터 담당). (5) export = mermaid/DBML(텍스트 우선) → SVG → PNG(1x/2x/4x) 순서로 승격, 항상 뷰포트가 아닌 전체 그래프 offscreen 렌더 기준. (6) `SchemaGraphDiffPanel` 의 스키마 diff 를 ERD 위 하이라이트로 연동(신규/삭제/변경 시각 표시). 전 항목의 유일한 데이터 입력은 shared `SchemaGraph` — catalog 파싱 중복 금지(ROADMAP H4 제약).

**이유**: 요구 기능(자연스러운 줌/팬, 노드 드래그, 수동 엣지 드로잉, 트리형 자동 배치, 대형 스키마 가상화, 키보드 a11y)을 수제 렌더러 위에 쌓으면 hit-testing/zoom 수학/엣지 라우팅 재발명 — 수개월 엣지케이스 비용. React Flow 가 목록 대부분 + a11y 기본기를 내장하고, elkjs layered 가 "FK 개수 가중치 기반 상하 배치" 요구를 표준 알고리즘(rank + barycenter + priority)으로 흡수해 배치 품질을 파라미터 튜닝 문제로 축소한다. 기각 대안: (a) 수제 렌더러 확장 — 위 비용. (b) dagre — worker 미지원·유지보수 정체, elkjs 대비 옵션 빈약.

**트레이드오프**:
- **+** 줌/팬/드래그/엣지 드로잉/미니맵/가상화가 라이브러리에서 공짜. 배치 품질은 튜닝 문제로 축소.
- **+** worker 레이아웃으로 수백 테이블에서 UI 블로킹 없음.
- **−** 프론트 의존성 2개 추가(@xyflow/react, elkjs) — 번들 크기·메이저 업그레이드 추종 비용.
- **−** 기존 dense ERD desktop/narrow screenshot smoke 와 SchemaErd 테스트 재작성 필요.
- **−** React Flow a11y 는 시작점일 뿐 — 키보드 링크 생성, 색+선스타일 이중 인코딩, reduced-motion 존중은 우리 구현 몫.

**관련**:
- ADR 0055(가상 FK 모델), 0056(persistence/reconcile/undo), 0057(포커스 필터) — 같은 ERD 재설계 세트.
- `docs/ROADMAP.md` H4(RDBMS intelligence) — 실행 순서는 ROADMAP/sprint 이 소유, 본 ADR 은 설계만 잠금.
- `src/components/schema/SchemaErdRenderer.tsx`, `src/components/schema/SchemaErdLayout.ts`, `src/components/schema/SchemaErdPanel.tsx` — 교체 대상.
- `src/types/schemaGraph.ts` — 유일 입력 계약.
