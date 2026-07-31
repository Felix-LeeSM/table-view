---
id: 0058
title: connection TLS advanced — CA 파일 + mTLS 클라이언트 인증서
status: Accepted
date: 2026-07-24
supersedes: null
superseded_by: null
---

**결정**: advanced TLS depth (#1649 / #1650, 2026-07-24 오너 grill) 의 열린 정책 결정을 확정한다. ADR 0053 이 core TLS 어휘(`tlsEnabled` + `trustServerCertificate` + pg/mysql `disable`/`prefer`/`require`/`verify-full`)를 잠그면서 명시 이월했던 depth 지점(CA 파일·클라이언트 인증서·1단 엔진 sslmode 확장·TOFU 인증서 핀)을 이 ADR 이 연다. **supersede 아님** — ADR 0053 의 어휘·기본값 위에 depth 를 얹는 후속이다. **(결정 1 — v1 depth 범위)** advanced 1차는 **CA 파일**(`verify-ca` sslmode: 사설 CA/자가서명 서버 인증서 검증) + **클라이언트 인증서**(mTLS: client cert + client key + key passphrase)까지 연다. **TOFU 인증서 핀은 후속으로 이월** — 인증서 핀은 CA 검증과 별개의 신뢰 앵커(CA 체인 없이 fingerprint 로 직접 핀)이며, 구현 시 ADR 0052 의 SSH TOFU 패턴(앱 관리 known_hosts 를 SQLite 에 영속, 첫 연결 사용자 확인 후 핀, 이후 불일치 hard-fail)을 그대로 재사용한다. **#1650 Oracle 1-way TLS**(TCPS 프로토콜 + CA 검증)는 이 CA-파일 결정 위에서 함께 승격한다 — Oracle wallet 기반 mTLS(#1065)와는 직교하는 별도 경로다. `verify-ca` 는 core 결정 경로 `src-tauri/src/db/tls.rs:56` `resolve_tls_decision()` / `TlsDecision` enum(`:26`, 현 4-variant `Disable`(`:34`)/`Default`(`:38`)/`RequireSkipVerify`(`:41`)/`RequireVerifyFull`(`:44`)) 의 verify 축(`RequireVerifyFull` 계열)을 확장하는 새 결정으로 편입한다. **(결정 2 — 엔진 커버리지: 전 엔진 균일)** advanced 필드를 **전 엔진에 동시 노출**한다 — RDB(PG/MySQL/MariaDB/MSSQL/Oracle) + KV(Redis/Valkey) + Doc(MongoDB) + Search(ES/OpenSearch). 1단 엔진(mongo/redis/valkey/es/os)의 boolean(skip-verify) → sslmode enum 마이그레이션을 **즉시 수행**한다 — ADR 0053 이 "advanced 도입 시 1단 엔진 boolean→enum 마이그레이션이 필요하다"고 예고한 그 지점이다. 이로써 ADR 0053 이 남긴 boolean/enum 어휘 분열을 해소한다. **(저장 모델 — 선례 계승, 재결정 아님)** advanced 인증서 자료는 **경로-참조-only** 로 저장한다: CA 파일·client cert·client key 는 **파일 내용을 저장하지 않고 경로만** 평문 저장하며, export 시 strip 한다(ADR 0052 의 SSH key 파일 경로 선례 + `src-tauri/src/commands/connection/io.rs` 의 DuckDB 절대경로 strip `reject_imported_local_database_path`(`:305`)·Oracle wallet 경로 strip `wallet_path=None`(`:88`) 패턴과 동형). client key **passphrase** 는 DB password 와 동일 계약 — keyring master-key 봉투(ADR 0040, `src-tauri/src/storage/crypto.rs:374` `encrypt`/`:389` `decrypt`)로 암호화 저장 + IPC 경계 마스킹(ADR 0005). `save_connection`(`src-tauri/src/commands/connection/crud.rs:50`)의 `Option<String>` 3-state(`Some`=교체 / `None`=유지 / empty=삭제)를 새 secret(passphrase)마다 확장 적용한다. `ConnectionConfig`(`src-tauri/src/models/connection.rs:81`, 현행 tls 필드 `tls_enabled`(`:113`)·`trust_server_certificate`(`:118`))에 CA 경로·client cert 경로·client key 경로·passphrase 필드를 확장한다. **구현 세부(필드명 확정, 드라이버별 sslmode↔네이티브 옵션 매핑, 1단 엔진 저장값 마이그레이션 절차, Oracle TCPS 결선, 폼 UI)는 이 ADR 범위 밖 — 구현 소관, tracker #1649.**

**이유**:

1. **CA 검증이 verify-full 의 사각을 메운다 (결정 1)** — 현행 `verify-full` 은 OS trust store 의 공개 CA 체인만 신뢰하므로, 사설 CA·자가서명 서버는 검증 자체가 불가능해 사용자가 `trust`(skip-verify)로 떨어질 수밖에 없다. `verify-ca` + CA 파일은 사용자가 지정한 CA 를 신뢰 앵커로 삼아 사설/자가서명 서버를 **진짜 검증** — MITM 인증서 치환을 방어한다(현행 skip-verify 자세의 구조적 구멍을 닫음). 클라이언트 인증서(mTLS)는 방향을 뒤집어 **서버가 클라이언트를 인증** — 엔터프라이즈 상호 인증 요구를 충족한다. 이 둘은 ADR 0053 이 core 에서 의도적으로 제외하고 #1649 로 이월한 정확히 그 depth 다.
2. **TOFU 인증서 핀을 지금 열지 않는 이유 (결정 1 이월)** — 인증서 핀은 CA 체인을 요구하지 않고 fingerprint 로 직접 신뢰하는 **별개의 신뢰 앵커**라, CA-파일/mTLS 와 다른 UX(첫 연결 확인 다이얼로그)·다른 영속(known_hosts 유사 SQLite 저장)·다른 불일치 정책(hard-fail)을 요구한다. ADR 0052 가 SSH host key 로 이미 세운 TOFU 패턴을 재사용하면 되지만, CA/mTLS 와 한 PR 에 묶으면 결정·구현·테스트 면적이 과대해진다. depth 를 버전 단위로 승격하는 원칙(ADR 0053 breadth-first 계승)에 따라 CA·mTLS 를 먼저 열고 TOFU 핀은 후속으로 남긴다.
3. **전 엔진 균일이 어휘 분열을 끝낸다 (결정 2)** — ADR 0053 은 core 를 통일하면서도 pg/mysql 만 sslmode enum 을 얹어 boolean(1단 엔진)/enum(pg·mysql) 두 어휘의 공존 기간을 남겼고(ADR 0053 트레이드오프 `−` 3항), advanced 도입 시 마이그레이션이 필요하다고 명시했다. advanced 를 전 엔진에 동시에 열고 1단 엔진 boolean→enum 을 즉시 마이그레이션하면 그 분열이 해소되어 사용자 멘탈 모델이 단일화된다("TLS 자세" 를 엔진마다 다르게 오해하는 문제 제거). 엔진별로 나눠 여는 대안은 어휘 분열 기간을 연장하고 마이그레이션을 반복시키므로 미채택.
4. **저장 모델은 새 결정이 아니라 검증된 선례의 상속 (저장 모델)** — CA/cert/key 파일 내용을 복제 저장하면 **두 번째 유출 지점**이 생기고 파일 권한(0600) 관리 책임이 앱으로 넘어온다. 경로만 참조하고 export 시 strip 하는 것은 ADR 0052 의 SSH key 경로 선례 및 io.rs 의 DuckDB/Oracle-wallet 경로 strip 과 동형이라 신규 정책 면적이 0 이다. passphrase 를 DB password 와 같은 keyring 봉투(ADR 0040) + IPC 마스킹(ADR 0005) + `Option<String>` 3-state 로 태우는 것도 ADR 0052 가 터널 secret 에 이미 확립한 계약을 그대로 잇는다. 따라서 저장 모델은 재결정이 아니라 선례 계승임을 명문화한다.

**트레이드오프**:

- **+** `verify-ca` + CA 파일로 사설/자가서명 서버의 MITM 인증서 치환 방어 — 현행 verify-full 이 못 덮던 사각(공개 CA만 커버)을 닫는다. client-cert(mTLS)로 엔터프라이즈 상호 인증 요구 충족.
- **+** 전 엔진 균일 + 1단 엔진 boolean→enum 즉시 마이그레이션으로 ADR 0053 이 남긴 어휘 분열 해소 — 사용자 멘탈 모델 단일화.
- **+** 저장 모델은 ADR 0052/0040/0005 선례 계승 — 새 저장 매체·새 신뢰 모델 0, 신규 정책 면적 최소. #1650 Oracle 1-way TLS 를 CA-파일 결정 위에 함께 승격해 별도 결정 라운드 절약.
- **−** **E2E/테스트/문서 비용 최대** — advanced 필드를 전 엔진(RDB 5 + KV 2 + Doc 1 + Search 2)에 동시에 열고 1단 엔진 마이그레이션까지 수행하므로, 폼·매핑·마이그레이션·E2E 검증 면적이 이번 결정의 최대 비용이다. 오너가 명시 수용한 트레이드오프(어휘 단일화의 대가).
- **−** **TOFU 이월로 skip-verify 잔존** — 자가서명이면서 CA 파일도 제공 불가한 서버(사내 임시 서버 등)는 TOFU 인증서 핀이 도입되기 전까지 여전히 skip-verify 자세에 머문다. verify-ca 로 대부분 흡수되지만 CA-불가 케이스의 잔여 위험은 후속까지 남는다.
- **−** **경로-참조-only 의 파일 의존** — CA/cert/key 파일을 이동·삭제·이름 변경하면 연결이 실패한다. 내용 복제 저장(두 번째 유출 지점) 대신 감수하는 트레이드오프 — ADR 0052 SSH key 경로와 동일 성질.
- **−** **verify-ca/verify-full 모두 신뢰 앵커 오염에 취약** — 사용자가 지정한 CA 파일이 이미 공격자 CA 라면 검증은 무력하다(ADR 0040 Threat 2·ADR 0053 트레이드오프 동형). CA 검증은 "치환 방어" 이지 "앵커 무결성 보장" 이 아니다.
- **재개 트리거**: 본 ADR 은 depth 범위(CA·mTLS)·엔진 커버리지(전 엔진)·저장 모델만 동결한다. 구현(advanced 폼 필드·필드명 확정, `TlsDecision` verify-ca 편입, 드라이버별 sslmode↔네이티브 매핑, 1단 엔진 boolean→enum 저장값 마이그레이션, Oracle TCPS/#1650 결선, CA/cert/key 경로 strip, passphrase 3-state)는 #1649 트래커 소관. **TOFU 인증서 핀**을 v2 로 승격할 때는 이 ADR 을 supersede 하지 않고 다시 depth 후속으로 얹는다(ADR 0052 TOFU 패턴 재사용). advanced 저장 모델을 내용-저장으로 뒤집으려면 새 ADR + Supersede.

**관련**:

- issue #1649 — advanced TLS depth-step 구현 트래커. 본 ADR 이 depth 범위·엔진 커버리지·저장 모델을 확정하고 needs-decision 해소, 잔여는 구현.
- issue #1650 — Oracle 1-way TLS(TCPS + CA). 결정 1 의 CA-파일 결정 위에서 함께 승격. wallet 기반 mTLS(#1065)와 직교.
- ADR 0053 — connection TLS core vocabulary + warning-first defaults. 본 ADR 의 직전(predecessor). core 어휘·기본값을 잠그며 CA·client-cert·1단 sslmode 확장·TOFU 핀을 #1649 로 이월했고, 본 ADR 이 그 depth 를 연다(supersede 아님).
- ADR 0052 — SSH 터널 TOFU host key 핀 + keyring 봉투 재사용. (a) 인증서 파일 경로-참조-only + export strip 의 저장 선례, (b) TOFU 인증서 핀 후속 구현 시 재사용할 TOFU 패턴(known_hosts SQLite 영속·불일치 hard-fail).
- ADR 0040 — File-key OS keyring 봉투. client key passphrase 가 재사용하는 master-key 저장 계약. verify-ca 도 못 막는 신뢰 앵커 오염(Threat 2) 동형 수용선.
- ADR 0005 — plaintext 비밀번호는 IPC 경계를 넘지 않는다. passphrase 도 동일 마스킹 불변식.
- ADR 0021 — Export envelope. CA/cert/key 파일 경로는 strip, passphrase 는 envelope 로 export/import.
- `docs/explorations/connection-tls-parity-threat-model-2026-07-17.md` — 본 결정의 threat-model 근거(§5c 후속 인증서 위협면, §5a 어휘, §6 잔여 위험). CA·client-cert 위협면과 잔여 skip-verify 자세의 출처.
- `src-tauri/src/db/tls.rs:56` — `resolve_tls_decision()` 공통 결정 경로 + `TlsDecision` enum(`:26`). verify-ca 결정 편입 지점.
- `src-tauri/src/models/connection.rs:81` — `ConnectionConfig`(현행 `tls_enabled`·`trust_server_certificate`). CA 경로·client cert/key 경로·passphrase 필드 확장 지점.
- `src-tauri/src/storage/crypto.rs:374` — master-key 봉투 `encrypt`/`decrypt`(`:389`). passphrase 암호화 확장 지점.
- `src-tauri/src/commands/connection/io.rs:88` — Oracle wallet 경로 strip / DuckDB 절대경로 strip(`reject_imported_local_database_path` `:305`). CA/cert/key 경로 export strip 이 따를 패턴.
- `src-tauri/src/commands/connection/crud.rs:50` — `save_connection` 의 `Option<String>` 3-state. passphrase secret 확장.
