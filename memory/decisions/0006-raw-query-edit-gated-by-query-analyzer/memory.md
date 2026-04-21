---
id: 0006
title: Raw query 결과 편집은 queryAnalyzer safety gate 통과 시만 허용
status: Accepted
date: 2026-04-20
---

**결정**: Raw SELECT 결과의 inline edit/delete는 `src/lib/queryAnalyzer.ts`가 "단일 테이블 + PK 컬럼 포함" 조건을 충족한다고 판정한 경우에만 활성화. JOIN, UNION, 서브쿼리가 포함된 결과는 읽기 전용.
**이유**: 다중 테이블 결과에 UPDATE/DELETE를 허용하면 어느 행·어느 테이블이 수정될지 SQL 생성 단계에서 모호해지고, 실수 한 번에 의도치 않은 대량 변경이 일어남. 명시적 safety gate로 "편집 가능한 결과"의 범위를 코드 수준에서 제한.
**트레이드오프**: + 오편집 방지, `rawQuerySqlBuilder.ts`의 SQL 생성 로직이 단일 테이블 전제로 단순화 / - 복잡 쿼리 결과는 편집 불가 — 사용자가 테이블 뷰로 이동해야 함.
