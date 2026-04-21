# Table View — Master Plan

## 프로젝트 목적

TablePlus와 동등한 로컬 데이터베이스 관리 도구를 만든다.

**판단 기준**: "TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

초기 DBMS는 PostgreSQL. 아키텍처는 다중 DBMS 확장을 전제로 설계.

## 현재 상태

Phase 1-4 완료 (Sprint 24-54 PASS). Phase 5(Extended Features) 진행 중 (Sprint 55-61 완료).
Phase 5 구현 항목: Views/Functions 백엔드(F2.6, F2.7 부분), Quick Look 패널(F3.6), 쿼리 즐겨찾기(F4.7 부분), 글로벌 쿼리 로그(F5.3), 환경 태그 배지(F1.4 부분), raw query 인라인 편집/삭제(Sprint 61), Cell Detail Dialog(Sprint 61), trailing semicolon 수정(Sprint 61).
주요 미구현 항목: 연결 색상 라벨 UI, View Structure 탭(F2.6), Functions CRUD, 즐겨찾기 키워드 바인딩, 결과 분할(F4.8), 패널 관리 시스템(F5.6), Import/Export, SSH 터널링, MySQL/SQLite 어댑터.

## 문서 목차

| 문서 | 설명 |
|------|------|
| [Architecture](architecture.md) | 시스템 구조, DB driver 추상화, 기술 결정 |
| [RISKS](RISKS.md) | 잔여 위험 등록부 (20개 항목, 상태 추적) |
| [Sprints](sprints/README.md) | harness sprint 실행 산출물 |

## 구현 계획

| Phase | 내용 | 상태 | 상세 |
|-------|------|------|------|
| 1 | Foundation (연결 관리) | 완료 | [phase-1.md](phases/phase-1.md) |
| 2 | Schema & Data Exploration | 완료 | [phase-2.md](phases/phase-2.md) |
| 3 | Query Editor | 완료 | [phase-3.md](phases/phase-3.md) |
| 4 | Editing & Polish | 완료 | [phase-4.md](phases/phase-4.md) |
| 5 | Extended Features | 진행 중 | [phase-5.md](phases/phase-5.md) |
| 6 | MongoDB 지원 | 계획 | [phase-6.md](phases/phase-6.md) |
| 7 | Elasticsearch 지원 | 계획 | [phase-7.md](phases/phase-7.md) |
| 8 | Redis 지원 | 계획 | [phase-8.md](phases/phase-8.md) |

## 참고 자료

- [TablePlus 문서](table_plus/) — 63개 참고 문서
- Tauri 2.0 가이드: https://v2.tauri.app/
- sqlx 문서: https://docs.rs/sqlx
