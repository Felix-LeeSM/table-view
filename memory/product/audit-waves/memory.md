---
name: 감사 wave 이력 + 다음 후보 추천안
description: breadth-first 감사 wave 의 완료 이력과 다음 wave 후보 우선순위 — 새 wave 착수 전 여기부터
type: topic
updated: 2026-07-16
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
| 2026-07-16 | workflow 감사 4축 (wave 28: SQLi·시크릿·패닉 도달성·에러UX / supportability / durability·state-sync·capability·i18n) | milestone 28.00~28.40, 감사 이슈 20건 #1549~1561·#1564~1566·#1580~1584 (P1 0, P2 다수: raw WHERE subquery SQLi #1549 / Oracle REPLACE·MSSQL HASHED·error_message 평문 #1550/1551/1553 / 마스터키 chmod race·Path C 손실 #1554/1555 / MySQL 재귀 crash #1557 / open_pool quarantine #1558 / keep_alive 재연결 우회 #1560 / 릴리스 로그 증발 #1564). **feature-discovery** 병행 산출 = NOW top5 #1525~1529 (H2 트랙, 미배정). verify layer 가 SQLi 오탐·IPC drift·SQLite PRAGMA·F3/F4 과장 impact 정정 (전량 채택 아님). 상세는 각 이슈 본문 |

## 다음 wave 후보 (2026-07-16 갱신 — 사용자 미확정)

- **에러 복구 UX** (07-10 후보) → wave 28 errux lane 으로 **부분 소화**: 재연결 우회 #1560, orphan 창 #1583, mongo 취소 #1561, open_pool corrupt/quarantine(#1303 계열) #1558, 크래시 draft 유실 #1580. 잔여 corrupt_recovery 심화가 필요하면 재도출.
- **Fable 미감사 잔여** (2026-07-16 Fable 자문 중 미착수): 윈도우 수명주기 리소스 누수(listen/unlisten 불균형), i18n 실측은 wave 28 에서 일부 커버(#1581/1582 잔여). 
- 신규 후보는 wave 28 산출(감사 20건) 소화 후 재도출.

선택 시점: wave 28 결과 소화 후. 선택되면 본 방의 해당 줄을 이력으로 승격.
