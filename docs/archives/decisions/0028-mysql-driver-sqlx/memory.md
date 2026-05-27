---
id: 0028
title: MySQL adapter 라이브러리 — sqlx::mysql (mysql_async 미채택)
status: Accepted
date: 2026-05-14
---

**결정**: Phase 17 MySQL adapter 의 driver 는 `sqlx::mysql` 채택. `mysql_async` 미채택. Phase 17 spec (R17.2) 이 가리킨 후보 ADR 번호는 0014 였으나 그 슬롯은 이미 점유돼 본 ADR 은 0028 로 부여.

**이유**:

1. **ADR 0001 정합** — sqlx 는 PostgreSQL adapter 의 backbone. PG adapter 와 동일 trait (`RdbAdapter`) 위에서 `Pool` / `Transaction` / prepared statement / type mapping 의 abstraction parity 가 자연스럽다. Sprint 281–288 의 1:1 mirror 작업 (Slice A~G + gap audit) 이 sqlx 의 PG↔MySQL 대칭에 의존한다.
2. **추가 의존성 최소** — `Cargo.toml` 에 `features = ["mysql"]` 한 줄로 활성화. 별도 runtime / error 모델 / type system 도입 비용 0.
3. **mysql_async 의 추가 능력 미사용** — replication stream, binlog 등 sqlx 가 노출하지 않는 mysql_async 기능은 Table View 의 desktop GUI use case 에서 사용 surface 가 없다.

**트레이드오프**:

- **+** PG adapter 와 코드 모양 동형 — Sprint 281 의 `list_namespaces`/`list_tables`/`get_columns` 부터 Sprint 287 의 sub-pool LRU cache 까지 PG 의 `cancel-token race` / `OnceLock` 패턴을 줄단위 답습 가능.
- **+** sqlx 의 compile-time checked query (`sqlx::query!`) 가 MySQL 방언도 지원.
- **−** `sqlx-mysql 0.8` 의 transitive `rsa 0.9` RUSTSEC-2023-0071 (Marvin Attack timing sidechannel) 노출. Table View 가 desktop 단일 사용자 모델이라 attacker 가 user connection 의 timing 을 네트워크상에서 측정할 채널이 없어 실 영향 없음 — Sprint 280 에서 `deny.toml` ignore 등록 + RISKS.md active 항목으로 추적. 해소 조건: sqlx 0.9+ 또는 rsa 0.10+.
- **−** `caching_sha2_password` 의 RSA fallback 비활성 (plain). dev fixture 가 `mysql_native_password` 강제 (Sprint 280 환경 fix). production MySQL 8.x 사용자도 동일 제약. mysql_async 였다면 `allow_public_key_retrieval` 옵션으로 우회 가능했으나 plaintext password 노출 위험 — ADR 0005 (plaintext password 는 IPC 경계를 넘지 않는다) 와 충돌하므로 채택했더라도 같은 결론.
- **−** dialect-specific 패턴 (`LAST_INSERT_ID()`, `INSERT ... ON DUPLICATE KEY UPDATE`, backtick quote, `AUTO_INCREMENT`) 은 sqlx 가 자동 추상화하지 않음. `RdbAdapter` trait 위에서 PG/MySQL 분기 — Sprint 282/284/285/288 에서 처리됨.
