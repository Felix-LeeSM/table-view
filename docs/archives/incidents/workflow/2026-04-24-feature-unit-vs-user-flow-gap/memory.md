---
title: 기능 유닛 완성 vs 사용자 흐름 엣지 검증 — Sprint 74-79 에서 연속 노출된 DoD 갭
type: lesson
date: 2026-04-24
---

**상황**: Sprint 74-79 로 UX 결함 6개 (NULL vs empty 구분, type-aware coerce, connection group UI 진입점, tab promotion hook, per-tab sort 상태, ConnectionDialog footer dead band) 를 연속 수정. 각 기능 유닛 자체는 이전 sprint 에서 "완성" 으로 평가됐지만, 실제 사용자 흐름에서 엣지가 드러나 재작업.
**원인**: Evaluator 의 Definition of Done 이 "유닛 테스트 통과 + gate 통과" 에 멈춰 있었고 (a) tri-state 값 (b) 여러 탭/패널 사이 상태 격리 (c) backend 는 있지만 UI 진입점 부재 (d) visual weight/여백 같은 미세 UX 회귀 축이 명시적으로 테스트되지 않음.
**재발 방지**: 앞으로 모든 sprint contract 의 Verification Plan 에 "엣지 3종 명시 테스트 — empty / null / long-value" + "backend 기능은 최소 한 개 UI 진입점 존재 여부" 를 필수 항목으로 고정. mixed profile 에선 브라우저 smoke 를 AC 가 아니라 invariant 로 취급.
