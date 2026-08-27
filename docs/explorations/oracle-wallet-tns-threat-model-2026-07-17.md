---
title: "Oracle wallet/TLS + SID/TNS 접속 옵션: threat-model handoff (#1065)"
type: threat-model-handoff
issue: "#1065"
updated: 2026-07-17
status: decisions locked 2026-07-17
---

# Oracle wallet/TLS + SID/TNS 접속 옵션: Threat-model handoff (issue #1065)

- 날짜: 2026-07-17
- 목적: grill(소유자 결정 인터뷰)에 진입하기 전에 informed consent 를 확보한다.
  결정을 lock 한 뒤에 본 문서는 SOT(product/ROADMAP/ADR/contributor)로 흡수하고
  폐기한다.
- 관련: issue #1065 (#904 후속), issue #1072 (Oracle full adapter 승격),
  ADR 0005 / 0021 / 0036 / 0040 / 0052, issue #1453 (연결 에러 redact).

## 0. 코드 재실증 (이슈 인용 :194-196 → 현재 위치)

이슈가 인용한 `oracle.rs:194-196` 은 한 줄만 shift 되었을 뿐 실질적으로 동일하다.
현행 거부 지점 전체는 아래 표와 같다
(`src-tauri/table-view-core/src/db/oracle.rs` 의 `connect_config()`).

| 라인 | 거부 대상 | 방식 |
|---|---|---|
| :161-165 | SID | `database` 필드 substring `SID=` 검사 |
| :166-174 | TNS/easy-connect descriptor | `DESCRIPTION=` / `CONNECT_DATA=` / leading `//` / `/` 포함 검사 |
| :178-182 | password 없는 external auth | password 비어 있으면 Validation 에러 |
| :183-187 | `auth_source` 재사용 | non-empty 거부 |
| :188-192 | `replica_set` 재사용 | non-empty 거부 |
| :193-197 | wallet/TLS | `tls_enabled` / `trust_server_certificate` true 거부 |

- 실제 연결은 `:199-206` 에서 이루어지며, `oracle_rs::Config::new(host, port,
  service_name, username, password)` 와 `connect_timeout` 만 사용하고 TLS/SID/TNS
  인자는 전달하지 않는다.
- 연결 에러는 `:519-521` 의 `map_oracle_connection_error` 를 거쳐
  `AppError::connection_redacted` (#1453 계약) 로 전달된다.
- 폼은 `src/features/connection/components/forms/OracleFormFields.tsx` 에 있고
  host/port/user/password/service name 5개 필드로 구성된다. 접속 방식을 고르는
  UI 는 없으며, `tls_enabled` 와 `trust_server_certificate` 도 노출하지 않는다
  (MSSQL 폼에서만 사용한다).

## 0.1 크레이트 지원 폭 (oracle-rs 0.1.7, crates.io, pure-Rust thin driver + rustls)

크레이트가 지원하는 항목은 다음과 같다.

- **SID**: `Config::with_sid(host, port, sid, user, pw)` 로 네이티브 지원한다.
- **TLS (TCPS)**: `Config::with_tls()` 로 지원하며, root store 는
  **webpki-roots 번들**이다 (문서는 "system certificates" 라고 적었지만 구현은
  `webpki_roots::TLS_SERVER_ROOTS` 를 사용한다).
- **wallet**: `Config::with_wallet(path, Some(password))` 를 호출하면 wallet
  디렉토리에서 `ewallet.pem` 을 읽어 (a) trust store 로 사용하고 (b) client
  cert+key 로 mTLS 를 수행한다. PKCS#8 encrypted private key 는 wallet password
  로 복호화한다 (`transport/tls.rs`).
- **mTLS (wallet 없이)**: `TlsConfig::with_client_cert(cert_pem, key_pem)` 으로
  구성한다.

지원하지 않거나 일부만 지원하는 항목은 다음과 같다.

- **TNS descriptor 파싱**: `Config::from_str` 은 EZConnect
  (`host:port/service`, `host:port:sid`) 형식만 받는다. `(` 로 시작하는 문자열을
  넘기면 `InvalidConnectionString("TNS descriptor format not yet supported")` 를
  반환한다.
- **cwallet.sso (auto-login wallet)**: `FeatureNotSupported` 를 반환한다.
  `ewallet.p12` 도 지원하지 않으며 `ewallet.pem` 형식만 받는다.
- **`danger_accept_invalid_certs` no-op**: `build_client_config()` 가
  `TlsConfig.verify_server=false` 를 **읽지 않으므로** 검증은 항상 켜져 있다.
  fail-closed 이기는 하지만, "trust server cert" UI 를 붙이면 사용자의 기대와
  실제 동작이 어긋난다.
- **`ssl_server_dn_match` 미구현**: 필드를 저장만 하고 사용하지는 않는다.
  hostname 검증은 rustls SNI 기본값에만 의존한다.
- **descriptor 조립에 escaping 0**: `Config::build_connect_string()` 이
  host/port/service/SID 를 `format!` 로
  `(DESCRIPTION=(ADDRESS=...)(CONNECT_DATA=...))` 에 그대로 삽입한다. 따라서
  `)(` 주입이 가능하다 (아래 위협 2.1 참고).
- **secret Debug 노출**: `oracle_rs::Config` 와 `TlsConfig` 는
  `#[derive(Debug)]` 를 쓰면서 `password` 와 `wallet_password` 를 그대로
  포함한다. 우리가 `ConnectionConfig` 에 적용한 manual Debug 마스킹(#1455,
  `models/connection.rs:127`)과 달리, 크레이트 Config 를 `{:?}` 로 출력하면
  평문이 유출된다.

## 1. 자산 (보호 대상)

1. **DB 비밀번호**: 기존 계약은 AES-256-GCM ciphertext 와 OS keyring master
   file-key 를 결합한다 (ADR 0040, `storage/crypto.rs` 의
   `get_or_create_key`/`encrypt`/`decrypt`). 이 값은 IPC 경계를 넘지 않는다
   (ADR 0005, `ConnectionConfigPublic` 은 `has_password` bool 만 노출한다).
2. **wallet 디렉토리 내용물**: 신규 자산이다. client private key 와 trust store
   를 담고, 경우에 따라 auto-login SSO(사실상 passwordless 자격증명)까지 담는다.
   wallet 을 탈취당하는 것은 곧 mTLS 클라이언트 신원을 탈취당하는 것이다. ADB 는
   wallet 과 user/pw 를 합친 2요소를 요구하지만, wallet 단독으로 유출되어도
   심각하다.
3. **wallet password**: 신규 secret 이다. ewallet.pem 에 담긴 encrypted key 를
   복호화하는 키다.
4. **wallet 경로 / TNS descriptor 문자열**: secret 은 아니지만 홈 디렉토리의
   username, 내부 인프라의 hostname, 토폴로지를 노출한다 (export 와 에러 메시지를
   거쳐 노출된다).
5. **연결 무결성**: 사용자가 의도한 서버에 의도한 보안 수준으로 접속한다는
   보장이다 (silent downgrade 나 redirect 가 없어야 한다).

## 2. 위협

### 2.1 SID / Service name / TNS descriptor: 파싱과 주입

- **descriptor 주입 (크레이트 escaping 0)**: service name, SID, host 필드에
  `)(` 를 포함한 문자열을 넣으면 `build_connect_string()` 이 산출하는
  descriptor 의 구조가 변형된다. 예를 들면 service name 에
  `X)(SERVER=DEDICATED))(ADDRESS=(HOST=evil...` 같은 값을 넣는 경우다. 로컬
  도구이므로 1인이 사용할 때는 "자기 자신 공격"에 그치지만,
  **import envelope 은 신뢰 경계다**. 남이 준 export JSON 을 import 하면 조작된
  필드가 사용자 자격증명을 의도하지 않은 호스트로 보내는 접속을 구성할 수 있다.
  현행 `connect_config()` 의 substring 거부
  (`DESCRIPTION=`/`SID=`/`/`)가 우연히 이 주입까지 막고 있는데, SID/TNS 를 열면
  이 방어가 사라지므로 대체 검증이 반드시 필요하다.
- **TNS descriptor = 사용자 입력 자유문자열**: 크레이트가 파싱하지 못하므로 이
  형식을 수용하려면 자체 파서가 필요하다. 파서는 그 자체가 attack surface 이다
  (ADR 0052 Q3 도 같은 이유로 pure-Rust 를 선택했다). 더 나쁜 것은
  **부분 구현이 일으키는 silent downgrade** 이다. descriptor 는
  `(SECURITY=(SSL_SERVER_CERT_DN=...))`, `(ADDRESS_LIST=...)` failover,
  `(HTTPS_PROXY=...)` 처럼 보안 semantic 을 담는다. 앱이 일부 절만 해석하고
  나머지를 조용히 버리면, 사용자는 "descriptor 에 적힌 보안 지시가 적용됐다"고
  믿지만 실제로는 그 지시가 무시된 상태로 접속한다.
- **tnsnames.ora alias**: ADB wallet zip 에 포함되어 있다. alias dropdown 이 UX
  관점에서는 정답이지만, tnsnames.ora 파서와 파일 읽기 권한이 표면을 추가로
  늘린다.
- **SID/Service name 자체**: Oracle identifier 는 사실상
  `[A-Za-z0-9_$#.]` 범위에 ADB service 의 `_high` 등이 더해진 형태다. 문자
  whitelist 로 주입을 완화할 수 있고, 파서 없이 정규식 1개면 충분하다.

### 2.2 wallet 디렉토리: 저장과 권한, 경로 노출

- **파일 권한**: 사용자가 Downloads 에 zip 을 풀면 권한은 통상 0644/0755 가
  된다. 이 상태에서는 Spotlight 인덱싱, Time Machine, iCloud/Dropbox sync 의
  대상이 된다. 앱이 경로만 참조하면 이 상태를 강제하지 못하므로, 경고와 검사를
  어느 수준까지 할지 결정해야 한다.
- **경로 노출**: 크레이트 에러 문자열이 경로를 그대로 출력한다
  (`"Failed to open cert file {path}"` 등). #1453 의 redact 는 URI userinfo 와
  `password=` 만 마스킹하므로, **경로는 현행 redact 계약 밖에 있다**. export
  envelope 에 경로가 실리면 홈 디렉토리의 username 이 노출된다 (DuckDB 절대경로
  strip 선례: `commands/connection/io.rs:282-296`).
- **내용 복제 저장 시**: 유출 지점이 하나 더 생기고 파일 권한에 대한 책임도
  앱으로 넘어온다. ADR 0052 Q5 가 SSH key 를 다룰 때 이미 기각한 방향이다.
- **zip 직접 수용 시**: zip 을 해제하는 동작 자체가 zip-slip/path-traversal
  표면이 된다. 사용자가 직접 풀게 하면 이 표면은 0 이다.

### 2.3 Oracle Cloud (Autonomous DB) mTLS 시나리오 요구사항

- ADB 의 기본 설정은 **mTLS 필수**이고 TCPS :1522 를 사용한다. 요구사항은
  (a) wallet 에 담긴 trust store 로 서버를 검증하는 것 (서버 cert 는 Oracle 자체
  CA 가 발급하므로 webpki-roots 로는 검증에 실패한다), (b) wallet 에 담긴 client
  cert+key 로 클라이언트를 인증하는 것, (c) encrypted key 를 복호화할 wallet
  password 를 확보하는 것이다.
- oracle-rs 의 `with_wallet` 이 (a)(b)(c) 를 모두 충족하지만,
  **`ewallet.pem` 형식에 한정된다**. 최근 ADB wallet zip 은 ewallet.pem 을
  포함하지만, 구형 zip 에는 `cwallet.sso` 나 `ewallet.p12` 만 있을 수 있다.
- 접속 좌표는 `tnsnames.ora` 에 담긴 TNS descriptor (alias `xxx_high` 등) 로
  배포되므로, TNS descriptor 를 지원하지 않으면 사용자가 host/port/service_name
  을 직접 추출해야 한다 (마찰은 크지만 보안 측면에서는 안전하다).
- ADB 에는 1-way TLS 모드 (mTLS 해제) 도 존재한다. wallet 없이 `with_tls()` 로
  접속할 수 있지만, Oracle CA root 가 webpki-roots 에 없으면 CA cert 파일을
  지정해야 한다 (`with_ca_cert`).
- `ssl_server_dn_match` 미구현으로 남는 문제: sqlnet.ora 에 적힌
  `SSL_SERVER_DN_MATCH=yes` 를 존중하지 못한다. rustls 의 hostname 검증이
  실질적인 대체 수단이지만 semantic 이 동일하지는 않다.

### 2.4 supply-chain / 크레이트 성숙도

- oracle-rs 0.1.7 은 0.1.x 대의 초기 버전이다. TNS wire protocol 과 O5LOGON
  인증 crypto(aes/cbc/pbkdf2/md5/sha1 에 의존한다)를 자체 구현한 파서·암호
  코드다. 신뢰할 수 없는 원격 서버 입력을 파싱하는 코드가 미성숙한 크레이트에
  들어 있다는 사실 자체가 표면이다 (pure-Rust 이므로 memory-safety 는 언어가
  보장하고, ADR 0052 Q3 과 동일한 논리로 C 바인딩보다는 우위에 있다).
- `verify_server` no-op 과 `ssl_server_dn_match` 미구현, Debug secret 노출은
  업스트림 수정이나 포크 없이는 앱에서 고칠 수 없는 부분과 (Debug 를 출력하지
  않는 것처럼) 앱의 규율로 막을 수 있는 부분이 섞여 있다.

### 2.5 사이드채널

- 크레이트 `Config` 와 `TlsConfig` 에 적용된 derive Debug (§0.1) 때문에, 앱
  코드에서 `oracle_rs::Config` 를 로그에 `{:?}` 로 출력하는 순간 password 와
  wallet password 가 평문으로 남는다. (앱 자체의 `ConnectionConfig` 는 manual
  Debug 로 이미 방어했다.)
- 에러 문자열이 경로와 DN 을 그대로 출력하면 그 값이 사이드바, status 이벤트,
  로그까지 도달한다 (#1453 표면).

## 3. 현재 인프라 정밀 분석 (재사용 가능한 계약)

| 계약 | 위치 | Oracle 확장 시 |
|---|---|---|
| plaintext IPC 미월경 | ADR 0005, `ConnectionConfigPublic` (password 필드 없음) | wallet password 도 동일하게 적용하고, 프론트에는 `hasWalletPassword` 류 bool 만 노출 |
| secret 암호화 봉투 | ADR 0040, `storage/crypto.rs` AES-256-GCM + keyring `com.tableview.app.file-key` | wallet password 를 같은 봉투로 (ADR 0052 Q5 가 터널 secret 에서 세운 선례 그대로) |
| secret 3-state 갱신 | `commands/connection/crud.rs` `Option<String>` (Some=교체/None=유지/empty=삭제) | wallet password 필드에 확장 |
| 파일 자격증명 = 경로만 저장 | ADR 0052 Q5 (SSH key 내용 미저장) | wallet 디렉토리도 경로 참조가 선례 정합 |
| export 경로 strip | `commands/connection/io.rs:282-296` (DuckDB 절대경로) | wallet 경로 strip 동형 적용 |
| TLS 명시 결정 3-state | `db/mssql.rs:154-175` (`trust_server_certificate` 명시 없으면 거부) | UI 패턴은 재사용 가능하나 크레이트 no-op 에 주의: Oracle 은 "검증 끄기"가 동작하지 않음 |
| 연결 에러 redact | #1453 `AppError::connection_redacted` (`error.rs:136`) | 경로와 DN 은 현행 패턴 밖이므로 redact 확장 필요 |
| export envelope | ADR 0021 (BIP39 + Argon2id) | wallet password ciphertext 포함 여부만 결정하면 봉투는 그대로 |
| telemetry 0 | ADR 0036 | wallet 경로와 host 를 포함해 어떤 것도 외부 송신 0, 신규 outbound 없음 |

## 4. 사용자 실수 시나리오

1. wallet zip 이나 디렉토리를 git repo 에 commit 하거나, Slack 에 첨부하거나,
   클라우드 sync 폴더에 방치한다. 앱이 경로만 참조하면 이를 막을 수 없고 경고만
   할 수 있다.
2. `ewallet.p12` 만 있는 구형 wallet 을 openssl 로 pem 으로 변환하다가 **평문
   private key 파일**을 만들어 방치한다 (변환 가이드를 제공하면 앱이 이 실수를
   유도하는 셈이므로, 가이드 문구에 위험을 함께 명시해야 한다).
3. wallet password 를 DB password 필드에 입력하거나 그 반대로 입력한다. 라벨과
   검증으로 완화할 수 있다.
4. TNS descriptor 필드에 `user/pw@host` 형태의 전체 connect string 을
   붙여넣는다. 따라서 descriptor 필드도 redact 와 마스킹 대상이어야 한다.
5. "안 되니까 검증 끄기" 식으로 반사적으로 클릭한다. MSSQL 식 trust 체크박스를
   Oracle 에 그대로 노출하면 (a) 크레이트가 no-op 이라 여전히 실패하고 (b) 훗날
   크레이트가 이를 구현하면 MITM 수용 스위치가 된다.
6. 남이 준 export JSON 을 import 한다. §2.1 descriptor 주입을 실제로 일으키는
   트리거다.
7. OS 계정이나 keyring 을 reset 한다. 그러면 wallet password ciphertext 를
   복구할 수 없다 (ADR 0040 이 이미 안고 있던 트레이드오프와 동일하고, 신규
   사항이 아니다).

## 5. 완화 (옵션별)

**A. 접속 방식 범위**
- A1 은 SID 와 Service name 만 받고 TNS descriptor 는 계속 거부하는 안이다.
  크레이트 네이티브 기능(`with_sid`)만으로 끝나므로 파서는 0 개이고, 주입 표면은
  whitelist 로 봉쇄한다. ADB 사용자는 tnsnames.ora 에서 좌표를 직접 추출해야
  한다 (마찰이 있지만 문서로 완화한다).
- A2 는 A1 에 tnsnames.ora **읽기 전용 alias 파서**를 더하는 안이다 (descriptor
  에서 host/port/service/protocol 만 추출하고, 그 외의 절을 발견하면 명시적으로
  에러를 낸다). 파서를 직접 소유하되 semantic 을 좁혀 silent downgrade 를
  차단하고, ADB 의 UX 문제를 해결한다.
- A3 는 자유문자열 TNS descriptor 필드를 두는 안이다. silent-downgrade 위험이
  가장 크고, 크레이트가 지원하지 않으므로 자체 파서가 full semantic 을 책임져야
  한다. 기각을 권장한다.
- 공통 사항으로 host/service/SID 의 문자 whitelist (`[A-Za-z0-9_$#.-]` 수준) 를
  `connect_config()` trust boundary 에서 강제한다. 이것이 주입을 완화하는 최소
  불변식이다.

**B. wallet 저장**
- B1 은 경로만 참조하고 export 시 경로를 strip 하며 권한이 느슨하면 1회
  경고하는 안이다. ADR 0052 선례와 정합한다. wallet 을 이동하거나 삭제해서
  연결이 실패하면 명시적인 에러로 알린다.
- B2 는 앱이 관리하는 디렉토리(0700)로 복제하는 안이다. 유출 지점이 1개 늘고
  ADR 0052 가 기각한 방향과 충돌한다. 기각을 권장한다.
- wallet password 는 keyring 봉투와 IPC 마스킹, 3-state 를 그대로 적용한다.
  선례를 그대로 따르므로 신규 정책은 0 이다.

**C. wallet 형식 갭**
- C1 은 ewallet.pem 만 지원하면서 "최신 wallet zip 을 다시 받으세요" 라고
  안내하는 안이다. 추가 코드는 0 이다.
- C2 는 p12 파서 의존성을 추가하는 안이다. 표면이 1개 늘고, 최신 zip 이 pem 을
  제공하므로 한계 효용이 낮다.
- C3 는 openssl 변환 가이드를 제공하는 안이다. 사용자가 평문 키를 만드는 실수를
  유도하므로, 제공한다면 경고 문구가 반드시 필요하다.

**D. 서버 검증 옵션**
- D1 은 Oracle 에 trust_server_certificate 를 노출하지 않는 안이다 (검증을 항상
  켜 둔다). 크레이트의 현실과 일치하고 MITM 스위치가 생기지 않는다. self-signed
  를 쓰는 온프레미스 환경은 CA cert 지정(`with_ca_cert` 노출)으로 해결한다.
- D2 는 MSSQL 과 동형인 체크박스를 노출하는 안이다. 현재는 no-op 이라 동작이
  불일치하고, 미래에는 MITM 스위치가 된다. 기각을 권장한다.

**E. 에러/로그**
- redact 를 확장해서 wallet 경로와 descriptor, DN 을 사이드바에 도달하기 전에
  마스킹한다 (#1453 과 동일한 표면이고 ADR 0052 Q6 과 동형이다). 그리고
  `oracle_rs::Config` 를 `{:?}` 로 출력하지 않는 규율을 세운다 (기존 #1455 의
  manual Debug 원칙을 크레이트 경계까지 확장하는 것이다).

## 6. 잔여 위험 (완화 후에도 남아서 소유자 수용이 필요한 것)

1. **oracle-rs 0.1.x 성숙도**: TNS 파서와 인증 crypto 를 초기 단계의 크레이트에
   위임한다. 업스트림이 정체되면 포크 부담을 진다. (실 ADB 환경이라는 검증
   인프라가 없으면 mTLS 경로는 CI 에서 검증되지 않은 채로 남는데, 이슈가 이
   항목을 P3 로 둔 이유가 여기에 있다.)
2. **`ssl_server_dn_match` 부재**: sqlnet.ora 에 적힌 DN 매치 semantic 을
   존중하지 못한다. rustls 의 hostname 검증이 실질적인 대체 수단이지만 동일하지는
   않다.
3. **wallet 파일 위생은 사용자 몫**: 경로 참조 모델에서는 권한과 sync, commit 에
   대해 경고까지만 할 수 있다.
4. **whitelist 는 완화일 뿐 증명이 아니다**: 크레이트에 escaping 이 없는 문제를
   근본적으로 수정하는 일은 업스트림의 몫이다.
5. **A1/A2 선택 시 descriptor 고급 기능 (failover list, proxy, DN match) 미지원**:
   이 기능이 필요한 사용자는 계속 접속하지 못한다. breadth 는 열리지만 depth 는
   후속으로 미룬다.

## Grill 결정 질문 (각 1줄, 결정 1개)

1. 접속 방식 1차 범위: A1(SID+Service만) / A2(+tnsnames.ora alias 파서) / A3(자유 descriptor) 중 무엇으로 정하는가?
2. A2 채택 시 파서 정책: 미지원 절 발견 시 명시 에러(hard-fail)로 silent downgrade 를 차단하는가?
3. host/service/SID 문자 whitelist 를 backend trust boundary(`connect_config`) 불변식으로 강제하는가?
4. wallet 저장 모델: 경로 참조만(B1, ADR 0052 선례) 으로 확정하는가?
5. wallet password: keyring 봉투 + IPC 마스킹 + 3-state 확장(선례 그대로) 으로 저장하는가, 아니면 매 접속 입력인가?
6. wallet 디렉토리 권한이 느슨할 때: 경고만 / hard-fail / 무검사 중 무엇인가?
7. export envelope 에서 wallet 경로를 DuckDB 선례대로 strip 하는가 (import 시 재지정)?
8. wallet 형식: ewallet.pem 단독 지원(C1) 인가, p12/변환 가이드(C2/C3) 까지 포함하는가?
9. trust_server_certificate 류 "검증 끄기" 옵션: Oracle 에는 미노출(D1) 로 확정하는가?
10. wallet 없는 1-way TLS(TCPS + CA cert 지정) 를 1차 범위에 포함하는가?
11. 에러 redact 확장: wallet 경로·descriptor·DN 마스킹을 #1453/ADR 0052 Q6 표면과 병행 처리하는가?
12. 검증 인프라: 실 Oracle Cloud ADB 계정을 확보하는가, 로컬 TCPS 컨테이너로 mTLS 검증을 대체하는가?
13. 배포 묶음: 이슈 권고대로 #1072(full adapter 승격) 와 같은 버전대로 확정하는가?

## 결정 (2026-07-17 grill)

오너 grill 에서 아래 내용을 lock 했다. #1065 의 결정은 ADR 대상이 아니며
(breadth-first 로 접속 옵션을 확장하는 일이고 지속되는 아키텍처 결정이 아니다),
본 threat-model 과 이슈 기록으로 충분하다. 본문 §0~6 의 분석은 수정하지 않았다.

1. **접속 방식 1차 (§5-A)**: **A1 인 Service name + SID 만** 받는다 (crate
   네이티브 `with_sid`). TNS descriptor 는 미지원임을 명문화하고 후속으로
   미룬다. A2 (tnsnames.ora alias 파서) 와 A3 (자유 descriptor) 는 파서가 만드는
   attack surface 와 silent downgrade 때문에 채택하지 않았다 (질문 1 과 2).
2. **1-way TLS (TCPS + CA cert) 1차 미포함 (§5-D, §2.3)**: advanced TLS 의 CA
   지원과 묶어 후속 #1650 으로 분리한다 (질문 10). wallet **기반**
   mTLS(`with_wallet`)는 이번 breadth 에 포함되고, wallet **없는** cert 기반
   mTLS(`with_client_cert`, §0.1)만 범위 밖이다.
3. **검증 인프라 (§6-1)**: **로컬 TCPS docker 컨테이너**로 mTLS/TLS 경로를
   검증하고, 출하 전에 실 ADB 에서 수동으로 1회 검증한다 (질문 12: 상시 ADB
   계정을 확보하지 못했다).

**파생 결정**:

- host/service/SID 의 문자 whitelist 를 `connect_config()` trust boundary 의
  불변식으로 강제한다 (질문 3, §2.1 주입 완화).
- wallet 저장은 **경로 참조만** 한다 (B1, ADR 0052 SSH key 선례). 복제는 채택하지
  않았다 (질문 4).
- wallet password 는 **`password_enc` 계약** (ADR 0005/0040) 에 IPC 마스킹과
  3-state 를 더해 저장한다 (질문 5).
- wallet 디렉토리 권한이 느슨하면 **경고**한다 (hard-fail 은 아니다, 질문 6).
- export envelope 에서 **wallet 경로를 strip** 한다 (DuckDB `io.rs` 선례, 질문 7).
- wallet 형식은 **`ewallet.pem` 단독**으로 지원하고 openssl 변환 가이드를
  제공한다 (경고 문구 필수, 질문 8).
- `trust_server_certificate` 류의 "검증 끄기" 옵션은 **Oracle 에 노출하지
  않는다** (crate `verify_server` 가 no-op 이므로 D1, 질문 9).
- 에러 redact 를 확장한다 (wallet 경로, descriptor, DN). #1453 과 병행한다
  (질문 11, §5-E).
- 배포 묶음은 **#1072 (full adapter 승격) 와 같은 버전대**로 한다 (질문 13).

**후속 이슈**: #1650 (Oracle 1-way TLS: TCPS + CA cert, advanced TLS #1649 CA
지원과 묶음).
