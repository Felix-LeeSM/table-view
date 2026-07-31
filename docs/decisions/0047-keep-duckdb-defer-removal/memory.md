---
id: 0047
title: DuckDB 지원 유지 (제거 보류)
status: Accepted
date: 2026-07-03
---

**결정**: DuckDB 지원을 유지하고 제거를 보류한다 (2026-07-03, 오너 결정). 착수했던 제거 작업은 commit 없이 폐기하고, 제거 tracker issue #1192 는 P3 로 하향해 open 유지한다.

**이유**: 제거의 주 동인이던 CI Integration coverage job 디스크 고갈 (`No space left on device`, duckdb 계측 컴파일 중 발생) 이 debuginfo 제거로 해소됐다 — `src-tauri/Cargo.toml` `[profile.dev] debug = 0` (PR #1196, merge SHA 6c022e63). 원인은 duckdb 단독이 아니라 "libduckdb.a 1.7GB 정적 링크 × 통합 테스트 바이너리 10개 × dev 프로필 full debuginfo" 의 곱셈 구조였고, llvm-cov 는 DWARF 가 불필요하므로 debuginfo 를 제거하면 곱셈 항이 사라진다. DuckDB 유지는 breadth-first 제품 방향과도 정합.

**트레이드오프**:
- **+** DBMS breadth 유지 — ADR 0046 의 RdbAdapter spine 위 file analytics 진로를 닫지 않음. 기존 duckdb 사용자 무영향.
- **−** libduckdb C++ 컴파일 시간 (cold build 수 분~20분대) 과 정적 바이너리 크기 부담이 잔존한다.
- **−** read-only parity 결손 (#1052 / #1070 / #1106) 은 미해결로 남는다.
- **재개 트리거**: duckdb 기인 빌드 비용/유지비 문제 재발 시 #1192 에서 재평가. Tracker: issue #1192 (P3, open).

**관련**:
- PR #1196 — `[profile.dev] debug = 0` (디스크 고갈 근본 해소).
- issue #1192 — DuckDB 제거 tracker (P3, open).
- ADR 0046 — data source profile / capability architecture (RdbAdapter + DuckDB 진로).
