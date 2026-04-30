---
title: Phase 종료 시 UI evaluation → sprint 분해 워크플로우
type: lesson
date: 2026-04-25
---

# Phase 종료 시 정적 UI evaluation → sprint 분해 워크플로우

## 상황
Phase 5 종료 시 정적(코드 리딩 기반) UI 평가 1회 수행. heuristics 8개 + 25 섹션 + 0~5 척도. 총점 3.17/5, 41 이슈 식별.

## 분류 패턴
- **P1 사용자 리포트 5건** → sprint-97~101 (Dirty indicator, Cmd+S 피드백, 빈 상태 분리, 다중 statement 분리, Mongo read-only 배너)
- **P2 권고 10건** → sprint-89~119 분산
- **Dialog primitive 정규화 6항목** → sprint-95/96 (Layer1Base + Layer2Preset)
- **⚠️ 정적 분석 한계 9건** → 실측 큐 (현재 `RISKS.md` RISK-026~034)

## 원인 / 재발 방지
정적 코드 리딩만으로는 WCAG 실측·스크롤 FPS·SR 발화 경로 등을 판정 불가. 이런 ⚠️ 항목은 **실측 큐로 외화**해야 잊히지 않음.

## 재현 조건 (Phase 6/7 종료 시)
- 평가 템플릿은 phase-agnostic — 새 paradigm 추가 시 paradigm 일급 개념 섹션만 보강.
- 산출 문서(`ui-evaluation*.md`)는 **일회성**. 결과는 sprint contract와 RISKS.md로 분해 후 원본은 정리.
- ⚠️ 항목은 RISKS의 별도 영역(또는 별도 추적 큐)으로 흡수.

## 출처
2026-04-25 `docs/ui-evaluation.md` (템플릿 597줄) + `ui-evaluation-results.md` (373줄) + `ui-evaluation-followup.md` (54줄) + `ui-fixes-plan.md` (108줄). 2026-04-30 sprint contract와 RISKS로 분해 후 4개 모두 삭제. 평가 결과 자체는 `git log --grep="UI evaluation"` + sprint-88~119 contract로 추적.
