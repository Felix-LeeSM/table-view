---
id: 0058
title: tvw CLI surface — one-shot v0.1, 자동화+에이전트 목적지, TUI non-goal
status: Accepted
date: 2026-07-25
supersedes: null
superseded_by: null
---

**결정**: `tvw` CLI surface 신설 (2026-07-25, 오너 grill).

- **v0.1 (일반 공개 베타)**: one-shot 실행 전용 — `tvw query <profile|--url DSN> "SQL"`. DBMS 는 SQL 코어 4종 (PostgreSQL / MySQL / MariaDB / SQLite). 나머지 지원 DBMS 는 ROADMAP CLI 트랙 항목으로만 둔다.
- **Safe Mode**: 기본 on. `sql-parser-core` tier 판정으로 destructive 문을 차단하고 전용 exit code 를 반환하며, `--allow-destructive` 로만 해제한다. TTY 여부에 따른 동작 분기 없음.
- **연결**: 앱과 동일한 암호화 프로필 store + OS keyring (`com.tableview.app.file-key`) 공유, `--url` DSN 직접 입력, CLI 프로필 관리 (`tvw conn add/ls/rm`) 모두 v1 범위. CLI 쓰기 경로는 기존 reconcile / corrupt-recovery 계약을 그대로 탄다.
- **출력**: 기본 table 고정 (TTY/파이프 동일), `--format json|csv` 명시 전환. exit code = 0 성공 / 1 에러 / safe-mode 차단 전용 코드.
- **아키텍처**: `table-view-core` workspace crate 신설 — `src-tauri/src/db/` + `storage/` + `models/` 이동, tauri path API 의존 3건은 data-dir 파라미터 주입으로 교체. feature-flag 로 tauri 옵션화하는 방식은 기각.
- **이름/배포**: bin `tvw` (crates.io 가용 확인, `tv` 는 tidy-viewer 점유). GH Releases + `cargo install`, 앱과 독립 버전 (`cli-v0.1.0` 태그) + 앱 번들 동봉 (VS Code 식 "Install CLI" symlink, Windows 는 installer PATH).
- **최종 목적지**: 자동화 + 에이전트 표면. 사다리: one-shot → REPL + parser-core completion → 앱 지원 DBMS 확장 (CLI claim ⊆ 앱 claim 원칙) → `tvw mcp` 서버 모드 (에이전트가 Safe Mode 아래 저장 프로필로 DB 접근). **TUI 는 영구 non-goal** — 인터랙티브 워크벤치는 앱의 역할.
- **sequencing**: CLI 는 새 DBMS claim 을 만들지 않는 surface 트랙이라 runtime promotion freeze (ROADMAP 순서 규칙 3) 대상이 아니다. 승격 시점은 ROADMAP 승격 후보 목록이 소유한다.

**이유**: `db/` 30+ 파일이 tauri 무의존이라 core 재사용 한계비용이 낮다. 차별점 3개 — 저장 프로필 공유, Safe Mode 판정, 다중 DBMS 단일 바이너리 — 가 psql/usql 대비 존재 이유를 만들고, 셋 다 기존 자산 재사용이다. 일반 공개 제품이므로 출력/exit code 는 환경 무관 결정론을 우선했다 (TTY 자동 분기 기각 — 같은 명령이 환경마다 다른 출력이면 CI 디버깅 함정). tauri 를 lib 로만 의존해도 Linux 에서 webkit2gtk 시스템 의존이 붙어 단독 배포 CLI 가 불가능 — crate 분리가 유일 경로다.

**트레이드오프**:
- **+** sql-parser-core 의 crate 분리 전례 그대로. 앱/CLI 가 안전 계약 (Safe Mode tier, 암호화 store) 을 단일 소스로 공유. 에이전트 수요 축 (`tvw mcp`) 을 목적지에 선점.
- **−** 앱·CLI 동시 프로필 쓰기 — reconcile 계약 검증이 v0.1 최우선 구현 리스크.
- **−** 일반 공개 = DBMS 4종 각각 CLI evidence (testcontainers 재사용) + support-claim 문서 매트릭스 비용.
- **−** standalone 바이너리는 macOS keychain ACL 1회 승인 프롬프트 마찰 — 앱 번들판은 동일 팀 서명으로 완화.

**관련**:
- ADR 0045 — language core (parser-core 재사용 기반)
- ADR 0046 — data-source architecture (adapter/capability 계약)
- `docs/ROADMAP.md` 트랙 맵 "CLI surface" — 장기 방향 소유
- GitHub milestone 33.00 — v0.1 실행 bucket
