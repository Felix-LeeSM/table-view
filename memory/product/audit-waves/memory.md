---
name: 감사 wave 이력 + 다음 후보 추천안
description: breadth-first 감사 wave 의 완료 이력과 다음 wave 후보 우선순위 — 새 wave 착수 전 여기부터
type: topic
updated: 2026-07-10
task: audit, wave, roadmap, milestone
---

# 감사 wave — 이력 + 다음 후보

breadth-first 방향 ([workflow/delivery](../../workflow/delivery/memory.md) 파이프라인이 산출 이슈를 소화).
새 감사 wave 착수 전 본 방에서 기완료 영역 중복을 피하고, 완료 시 이력에 추가한다.

## 완료 이력

| 시기 | 영역 | 산출 |
|---|---|---|
| 2026-07-02 | DBMS parity/UX (wave 22) | milestone 22.00~22.80, #1041~#1077 |
| 2026-07-02 | 4-영역 감사 (wave 23) | milestone 23.00~23.50, #1079~#1111, security label |
| 2026-07-02 | agent 보조도구·Safe Mode (21.x/24.x) | #1021~#1040, #1112~#1125 |
| 2026-07-03 | CI/hook + CI 캐시 | #1167~#1179 merge, ruleset required 등록(07-05 Dependency Security 1차) |
| 2026-07-04 | CI flake 전수 조사 | #1293 + fix #1341/#1342 |
| 2026-06~07 | a11y/design (25.x) | #1007~#1020, #1078, #1127~#1142 계열 |
| 2026-07-05 | 코드 퀄리티 (wave 26) | milestone 26.00~26.40 (GH #82~#86), 이슈 #1350~#1370 (21건, P1 4건: 다중 CTE classifier·Oracle backend fail-open·PG export 정밀도·PK write 이중 인코딩) |
| 2026-07-10 | 4축 통합 (wave 27: 데이터 무결성/릴리스·패키징/성능·대용량/보안 2차) | milestone 27.00~27.30 (GH #87~#90), 이슈 #1429~#1455 (27건, P1 10건: single-row 가드 MSSQL·Oracle 누락 / INSERT identity NULL / latest.json 완전성 / updater 서명 무검증 / SQL 결과·export 대용량 무방비 / export path 가드 narrow / classifier 3벡터 / 히스토리 평문 password / state.db 0600). 상세는 각 milestone 이슈 본문 |

## 다음 wave 후보 (2026-07-10 갱신 — 사용자 미확정)

1. **에러 복구 UX** — 재연결, 크래시 복구, corrupt_recovery (#1303 이 신호). 07-05 추천안 5개 중
   유일하게 미실행으로 잔존 (나머지 4개는 wave 27 에서 "다 하자" 지시로 일괄 실행).
2. 신규 후보는 wave 27 산출 소화 후 재도출.

선택 시점: wave 27 결과 (P1 10건) 소화 후. 선택되면 본 방의 해당 줄을 이력으로 승격.
