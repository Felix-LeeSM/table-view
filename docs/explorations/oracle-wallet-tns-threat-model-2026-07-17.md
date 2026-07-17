---
title: Oracle wallet/TLS + SID/TNS 접속 옵션 — threat-model handoff (#1065)
type: threat-model-handoff
issue: "#1065"
updated: 2026-07-17
status: decisions locked 2026-07-17
---

# Oracle wallet/TLS + SID/TNS 접속 옵션 — Threat-model handoff (issue #1065)

- 날짜: 2026-07-17
- 목적: grill(소유자 결정 인터뷰) 진입 전 informed consent. 결정 lock 후
  본 문서는 SOT(product/ROADMAP/ADR/contributor)로 흡수하고 폐기한다.
- 관련: issue #1065 (#904 후속), issue #1072 (Oracle full adapter 승격),
  ADR 0005 / 0021 / 0036 / 0040 / 0052, issue #1453 (연결 에러 redact).

## 0. 코드 재실증 (이슈 인용 :194-196 → 현재 위치)

이슈가 인용한 `oracle.rs:194-196` 은 1줄 shift, 실질 동일. 현행 거부 지점
전체 (`src-tauri/src/db/oracle.rs`, `connect_config()`):

| 라인 | 거부 대상 | 방식 |
|---|---|---|
| :161-165 | SID | `database` 필드 substring `SID=` 검사 |
| :166-174 | TNS/easy-connect descriptor | `DESCRIPTION=` / `CONNECT_DATA=` / leading `//` / `/` 포함 검사 |
| :178-182 | password 없는 external auth | password 비어 있으면 Validation 에러 |
| :183-187 | `auth_source` 재사용 | non-empty 거부 |
| :188-192 | `replica_set` 재사용 | non-empty 거부 |
| :193-197 | wallet/TLS | `tls_enabled` / `trust_server_certificate` true 거부 |

- 실제 연결은 `:199-206` — `oracle_rs::Config::new(host, port, service_name,
  username, password)` + `connect_timeout` 만 사용. TLS/SID/TNS 인자 미전달.
- 연결 에러는 `:519-521` `map_oracle_connection_error` →
  `AppError::connection_redacted` (#1453 계약) 경유.
- 폼: `src/features/connection/components/forms/OracleFormFields.tsx` —
  host/port/user/password/service name 5필드. 접속 방식 선택 UI 없음.
  `tls_enabled` / `trust_server_certificate` 노출 없음 (MSSQL 폼만 사용).

## 0.1 크레이트 지원 폭 (oracle-rs 0.1.7, crates.io, pure-Rust thin driver + rustls)

지원함:

- **SID**: `Config::with_sid(host, port, sid, user, pw)` — 네이티브.
- **TLS (TCPS)**: `Config::with_tls()` — root store 는 **webpki-roots 번들**
  (문서는 "system certificates" 라 하지만 구현은 `webpki_roots::TLS_SERVER_ROOTS`).
- **wallet**: `Config::with_wallet(path, Some(password))` — wallet 디렉토리에서
  `ewallet.pem` 을 읽어 (a) trust store 로 사용, (b) client cert+key 로 mTLS.
  PKCS#8 encrypted private key 를 wallet password 로 복호화 (`transport/tls.rs`).
- **mTLS (wallet 없이)**: `TlsConfig::with_client_cert(cert_pem, key_pem)`.

지원 안 함 / 반쪽:

- **TNS descriptor 파싱**: `Config::from_str` 은 EZConnect
  (`host:port/service`, `host:port:sid`)만. `(` 로 시작하면
  `InvalidConnectionString("TNS descriptor format not yet supported")`.
- **cwallet.sso (auto-login wallet)**: `FeatureNotSupported`. `ewallet.p12` 도
  미지원 — `ewallet.pem` 만.
- **`danger_accept_invalid_certs` no-op**: `TlsConfig.verify_server=false` 를
  `build_client_config()` 가 **읽지 않는다** — 검증은 항상 켜짐 (fail-closed
  지만, "trust server cert" UI 를 붙이면 사용자 기대와 동작 불일치).
- **`ssl_server_dn_match` 미구현**: 필드 저장만 하고 미사용. hostname 검증은
  rustls SNI 기본만.
- **descriptor 조립에 escaping 0**: `Config::build_connect_string()` 이
  host/port/service/SID 를 `format!` 로
  `(DESCRIPTION=(ADDRESS=...)(CONNECT_DATA=...))` 에 그대로 삽입. `)(` 주입
  가능 (아래 위협 2.1).
- **secret Debug 노출**: `oracle_rs::Config` 와 `TlsConfig` 는
  `#[derive(Debug)]` 에 `password` / `wallet_password` 포함 — 우리
  `ConnectionConfig` 의 manual Debug 마스킹(#1455, `models/connection.rs:127`)
  과 달리 크레이트 Config 를 `{:?}` 하면 평문 누출.

## 1. 자산 (보호 대상)

1. **DB 비밀번호** — 기존 계약: AES-256-GCM ciphertext + OS keyring master
   file-key (ADR 0040, `storage/crypto.rs` `get_or_create_key`/`encrypt`/`decrypt`),
   IPC 미월경 (ADR 0005, `ConnectionConfigPublic` 은 `has_password` bool 만).
2. **wallet 디렉토리 내용물** — 신규 자산. client private key + trust store,
   경우에 따라 auto-login SSO(사실상 passwordless 자격증명). wallet 절도 =
   mTLS 클라이언트 신원 절도. ADB 는 wallet + user/pw 2요소지만 wallet 단독
   유출도 심각.
3. **wallet password** — 신규 secret. ewallet.pem 의 encrypted key 복호화 키.
4. **wallet 경로 / TNS descriptor 문자열** — secret 은 아니나 홈 디렉토리
   username·내부 인프라 hostname·토폴로지 노출 (export/에러 메시지 경유).
5. **연결 무결성** — 사용자가 의도한 서버에 의도한 보안 수준으로 붙는다는
   보장 (silent downgrade / redirect 없음).

## 2. 위협

### 2.1 SID / Service name / TNS descriptor — 파싱·주입

- **descriptor 주입 (크레이트 escaping 0)**: service name·SID·host 필드에
  `)(` 포함 문자열을 넣으면 `build_connect_string()` 산출 descriptor 의
  구조가 변형된다. 예: service name
  `X)(SERVER=DEDICATED))(ADDRESS=(HOST=evil...` 류. 로컬 도구라 1인 사용
  시 "자기 자신 공격"이지만, **import envelope 은 신뢰 경계다** — 남이 준
  export JSON 을 import 하면 조작된 필드가 사용자 자격증명을 의도 밖 호스트로
  보내는 접속을 구성할 수 있다. 현행 `connect_config()` 의 substring 거부
  (`DESCRIPTION=`/`SID=`/`/`)가 우연히 이 주입도 막고 있다 — SID/TNS 를 열면
  이 방어가 사라지므로 대체 검증이 필수.
- **TNS descriptor = 사용자 입력 자유문자열**: 크레이트가 파싱 못 하므로
  수용하려면 자체 파서가 필요하다. 파서 = attack surface (ADR 0052 Q3 이
  같은 이유로 pure-Rust 를 골랐던 축). 더 나쁜 건 **부분 구현의 silent
  downgrade**: descriptor 는 `(SECURITY=(SSL_SERVER_CERT_DN=...))`,
  `(ADDRESS_LIST=...)` failover, `(HTTPS_PROXY=...)` 등 보안 semantic 을
  담는다. 앱이 일부 절만 해석하고 나머지를 조용히 버리면 사용자는 "descriptor
  의 보안 지시가 적용됐다"고 믿는데 실제로는 무시된 상태로 접속한다.
- **tnsnames.ora alias**: ADB wallet zip 에 포함. alias dropdown 이 UX 정답
  이지만 tnsnames.ora 파서 + 파일 읽기 권한이 추가 표면.
- **SID/Service name 자체**: Oracle identifier 는 사실상
  `[A-Za-z0-9_$#.]` (+ ADB service 의 `_high` 등). 문자 whitelist 로 주입
  완화 가능 — 파서 없이 정규식 1개.

### 2.2 wallet 디렉토리 — 저장·권한·경로 노출

- **파일 권한**: 사용자가 Downloads 에 zip 을 풀면 통상 0644/0755. Spotlight
  인덱싱, Time Machine, iCloud/Dropbox sync 대상. 앱이 경로만 참조하면 이
  상태를 강제 못 한다 (경고/검사 수준 결정 필요).
- **경로 노출**: 크레이트 에러 문자열이 경로를 echo 한다
  (`"Failed to open cert file {path}"` 등). #1453 redact 는 URI userinfo 와
  `password=` 만 마스킹 — **경로는 현행 redact 계약 밖**. export envelope 에
  경로가 실리면 홈 디렉토리 username 노출 (DuckDB 절대경로 strip 선례:
  `commands/connection/io.rs:282-296`).
- **내용 복제 저장 시**: 두 번째 유출 지점 + 파일 권한 책임이 앱으로 이관.
  ADR 0052 Q5 가 SSH key 에서 이미 기각한 방향.
- **zip 직접 수용 시**: zip 해제 = zip-slip/path-traversal 표면. 사용자가
  직접 풀게 하면 표면 0.

### 2.3 Oracle Cloud (Autonomous DB) mTLS 시나리오 요구사항

- ADB 기본 설정 = **mTLS 필수**, TCPS :1522. 요구: (a) wallet trust store 로
  서버 검증 — 서버 cert 는 Oracle 자체 CA 발급이라 webpki-roots 로는 실패,
  (b) wallet 의 client cert+key 로 클라이언트 인증, (c) encrypted key 복호화용
  wallet password.
- oracle-rs 의 `with_wallet` 이 (a)(b)(c) 모두 커버 — **단 `ewallet.pem` 형식
  한정**. 최근 ADB wallet zip 은 ewallet.pem 을 포함하지만, 구형 zip 은
  `cwallet.sso`/`ewallet.p12` 만 있을 수 있다.
- 접속 좌표는 `tnsnames.ora` 의 TNS descriptor (alias `xxx_high` 등) 로
  배포된다 — TNS descriptor 미지원이면 사용자가 host/port/service_name 을
  손으로 추출해야 한다 (마찰은 크지만 보안상은 안전).
- ADB 의 1-way TLS 모드 (mTLS 해제) 도 존재 — wallet 없이 `with_tls()` 로
  가능하나 Oracle CA root 가 webpki-roots 에 없으면 CA cert 파일 지정 필요
  (`with_ca_cert`).
- `ssl_server_dn_match` 미구현 잔여: sqlnet.ora 의 `SSL_SERVER_DN_MATCH=yes`
  를 존중 못 함. rustls hostname 검증이 실질 대체지만 semantic 동일하지 않음.

### 2.4 supply-chain / 크레이트 성숙도

- oracle-rs 0.1.7 — 0.1.x 초기 버전. TNS wire protocol + O5LOGON 인증
  crypto(aes/cbc/pbkdf2/md5/sha1 의존)를 자체 구현한 파서/암호 코드다.
  신뢰 불가한 원격 서버 입력을 파싱하는 코드가 미성숙 크레이트에 있다는 것
  자체가 표면 (pure-Rust 라 memory-safety 는 언어 보장, ADR 0052 Q3 과 동일
  논리로 C 바인딩 대비는 우위).
- `verify_server` no-op·`ssl_server_dn_match` 미구현·Debug secret 노출은
  업스트림 수정/포크 없이는 앱에서 못 고치는 부분과 (Debug 미출력처럼) 앱
  규율로 막는 부분이 섞여 있다.

### 2.5 사이드채널

- 크레이트 `Config`/`TlsConfig` 의 derive Debug (§0.1) — 앱 코드에서
  `oracle_rs::Config` 를 로그에 `{:?}` 찍는 순간 password/wallet password
  평문. (앱 자체 `ConnectionConfig` 는 manual Debug 로 방어 완료.)
- 에러 문자열의 경로/DN echo → 사이드바/status 이벤트/로그 (#1453 표면).

## 3. 현재 인프라 정밀 분석 (재사용 가능한 계약)

| 계약 | 위치 | Oracle 확장 시 |
|---|---|---|
| plaintext IPC 미월경 | ADR 0005, `ConnectionConfigPublic` (password 필드 없음) | wallet password 도 동일 — 프론트는 `hasWalletPassword` 류 bool 만 |
| secret 암호화 봉투 | ADR 0040, `storage/crypto.rs` AES-256-GCM + keyring `com.tableview.app.file-key` | wallet password 를 같은 봉투로 (ADR 0052 Q5 가 터널 secret 에서 세운 선례 그대로) |
| secret 3-state 갱신 | `commands/connection/crud.rs` `Option<String>` (Some=교체/None=유지/empty=삭제) | wallet password 필드에 확장 |
| 파일 자격증명 = 경로만 저장 | ADR 0052 Q5 (SSH key 내용 미저장) | wallet 디렉토리도 경로 참조가 선례 정합 |
| export 경로 strip | `commands/connection/io.rs:282-296` (DuckDB 절대경로) | wallet 경로 strip 동형 적용 |
| TLS 명시 결정 3-state | `db/mssql.rs:154-175` (`trust_server_certificate` 명시 없으면 거부) | UI 패턴 재사용 가능하나 크레이트 no-op 주의 — Oracle 은 "검증 끄기"가 동작하지 않음 |
| 연결 에러 redact | #1453 `AppError::connection_redacted` (`error.rs:136`) | 경로/DN 은 현행 패턴 밖 — redact 확장 필요 |
| export envelope | ADR 0021 (BIP39 + Argon2id) | wallet password ciphertext 포함 여부만 결정하면 봉투는 그대로 |
| telemetry 0 | ADR 0036 | wallet 경로/host 포함 어떤 것도 외부 송신 0 — 신규 outbound 없음 |

## 4. 사용자 실수 시나리오

1. wallet zip/디렉토리를 git repo 에 commit, Slack 첨부, 클라우드 sync 폴더에
   방치 — 앱이 경로 참조만 하면 못 막고, 경고만 가능.
2. `ewallet.p12` 만 있는 구형 wallet 을 openssl 로 pem 변환하다가 **평문
   private key 파일**을 만들어 방치 (변환 가이드를 제공하면 이 실수를 앱이
   유도하는 셈 — 가이드 문구가 위험을 함께 명시해야 함).
3. wallet password 를 DB password 필드에 입력 (또는 반대) — 라벨/검증으로 완화.
4. TNS descriptor 필드에 `user/pw@host` 전체 connect string 을 붙여넣기 —
   descriptor 필드도 redact/마스킹 대상이어야 함.
5. "안 되니까 검증 끄기" 클릭 반사 — MSSQL 식 trust 체크박스를 Oracle 에
   그대로 노출하면 (a) 크레이트 no-op 이라 여전히 실패하고 (b) 훗날 크레이트가
   구현하면 MITM 수용 스위치가 됨.
6. 남이 준 export JSON import — §2.1 descriptor 주입의 실제 트리거.
7. OS 계정/keyring reset — wallet password ciphertext 복구 불가 (ADR 0040
   기존 트레이드오프와 동일, 신규 아님).

## 5. 완화 (옵션별)

**A. 접속 방식 범위**
- A1 — SID + Service name 만 (TNS descriptor 계속 거부): 크레이트 네이티브
  (`with_sid`) 로 끝. 파서 0, 주입 표면은 whitelist 로 봉쇄. ADB 는 사용자가
  tnsnames.ora 에서 좌표 수동 추출 (마찰 있음, 문서로 완화).
- A2 — A1 + tnsnames.ora **읽기 전용 alias 파서** (descriptor 에서
  host/port/service/protocol 만 추출, 그 외 절 발견 시 명시 에러): 파서를
  소유하되 semantic 을 좁혀 silent downgrade 차단. ADB UX 해결.
- A3 — 자유문자열 TNS descriptor 필드: silent-downgrade 위험 최대, 크레이트
  미지원이라 자체 파서가 full semantic 을 책임져야 함. 기각 권장.
- 공통: host/service/SID 문자 whitelist (`[A-Za-z0-9_$#.-]` 수준) 를
  `connect_config()` trust boundary 에서 강제 — 주입 완화의 최소 불변식.

**B. wallet 저장**
- B1 — 경로 참조만 + export strip + 느슨한 권한 시 1회 경고: ADR 0052 선례
  정합. 이동/삭제 시 연결 실패는 명시 에러로.
- B2 — 앱 관리 디렉토리로 복제(0700): 유출 지점 +1, ADR 0052 기각 방향과
  충돌. 기각 권장.
- wallet password: keyring 봉투 + IPC 마스킹 + 3-state — 선례 그대로, 신규
  정책 0.

**C. wallet 형식 갭**
- C1 — ewallet.pem 만 지원 + "최신 wallet zip 을 다시 받으세요" 안내: 코드 0.
- C2 — p12 파서 의존성 추가: 표면 +1, 최신 zip 이 pem 을 주므로 한계 효용 낮음.
- C3 — openssl 변환 가이드 제공: 평문 키 생성 실수 유도 — 제공한다면 경고
  문구 필수.

**D. 서버 검증 옵션**
- D1 — Oracle 에는 trust_server_certificate 미노출 (검증 항상 on): 크레이트
  현실과 일치, MITM 스위치 없음. self-signed 온프레미스는 CA cert 지정
  (`with_ca_cert` 노출) 으로 해결.
- D2 — MSSQL 동형 체크박스 노출: 현재 no-op (동작 불일치), 미래 MITM 스위치.
  기각 권장.

**E. 에러/로그**
- redact 확장: wallet 경로·descriptor·DN 을 사이드바 도달 전 마스킹 (#1453
  과 동일 표면, ADR 0052 Q6 동형). `oracle_rs::Config` 를 `{:?}` 로 찍지
  않는 규율 (기존 #1455 manual Debug 원칙의 크레이트 경계 확장).

## 6. 잔여 위험 (완화 후에도 남는 것 — 소유자 수용 필요)

1. **oracle-rs 0.1.x 성숙도** — TNS 파서/인증 crypto 를 초기 크레이트에
   위임. 업스트림 정체 시 포크 부담. (검증 인프라 — 실 ADB 환경 — 없이는
   mTLS 경로가 CI 에서 미검증으로 남음, 이슈가 P3 로 둔 이유.)
2. **`ssl_server_dn_match` 부재** — sqlnet.ora 의 DN 매치 semantic 미존중.
   rustls hostname 검증이 실질 대체지만 동일하지 않음.
3. **wallet 파일 위생은 사용자 몫** — 경로 참조 모델에서 권한/sync/commit
   은 경고까지만 가능.
4. **whitelist 는 완화지 증명 아님** — 크레이트 escaping 부재의 근본 수정은
   업스트림 몫.
5. **A1/A2 선택 시 descriptor 고급 기능 (failover list, proxy, DN match) 미지원**
   — 해당 사용자는 계속 접속 불가. breadth 는 열리되 depth 는 후속.

## Grill 결정 질문 (각 1줄, 결정 1개)

1. 접속 방식 1차 범위: A1(SID+Service만) / A2(+tnsnames.ora alias 파서) / A3(자유 descriptor) 중 무엇으로 여는가?
2. A2 채택 시 파서 정책: 미지원 절 발견 시 명시 에러(hard-fail)로 silent downgrade 를 차단하는가?
3. host/service/SID 문자 whitelist 를 backend trust boundary(`connect_config`) 불변식으로 강제하는가?
4. wallet 저장 모델: 경로 참조만(B1, ADR 0052 선례) 으로 확정하는가?
5. wallet password: keyring 봉투 + IPC 마스킹 + 3-state 확장(선례 그대로) 으로 저장하는가, 아니면 매 접속 입력인가?
6. wallet 디렉토리 권한이 느슨할 때: 경고만 / hard-fail / 무검사 중 무엇인가?
7. export envelope 에서 wallet 경로를 DuckDB 선례대로 strip 하는가 (import 시 재지정)?
8. wallet 형식: ewallet.pem 단독 지원(C1) 인가, p12/변환 가이드(C2/C3) 까지 가는가?
9. trust_server_certificate 류 "검증 끄기" 옵션: Oracle 에는 미노출(D1) 로 확정하는가?
10. wallet 없는 1-way TLS(TCPS + CA cert 지정) 를 1차 범위에 포함하는가?
11. 에러 redact 확장: wallet 경로·descriptor·DN 마스킹을 #1453/ADR 0052 Q6 표면과 병행 처리하는가?
12. 검증 인프라: 실 Oracle Cloud ADB 계정을 확보하는가, 로컬 TCPS 컨테이너로 mTLS 검증을 대체하는가?
13. 배포 묶음: 이슈 권고대로 #1072(full adapter 승격) 와 같은 버전대로 확정하는가?

## 결정 (2026-07-17 grill)

오너 grill 에서 아래를 lock 했다. #1065 결정은 ADR 대상이 아니며 (breadth-first
접속 옵션 확장, 지속 아키텍처 결정 아님) 본 threat-model + 이슈 기록으로 충분.
본문 §0~6 분석은 무수정.

1. **접속 방식 1차 (§5-A)** — **A1: Service name + SID 만** (crate 네이티브
   `with_sid`). TNS descriptor 는 미지원 명문화 + 후속. A2 (tnsnames.ora alias
   파서)·A3 (자유 descriptor) 는 파서 attack surface·silent downgrade 로 미채택
   (질문 1·2).
2. **1-way TLS (TCPS + CA cert) 1차 미포함 (§5-D, §2.3)** — advanced TLS 의 CA 지원과
   묶어 후속 #1650 으로 분리 (질문 10). wallet 기반 mTLS 도 이번 breadth 범위 밖.
3. **검증 인프라 (§6-1)** — **로컬 TCPS docker 컨테이너**로 mTLS/TLS 경로 검증,
   출하 전 실 ADB 수동 1회 (질문 12 — 상시 ADB 계정 미확보).

**파생 결정**:

- host/service/SID 문자 whitelist 를 `connect_config()` trust boundary 불변식으로
  강제 (질문 3, §2.1 주입 완화).
- wallet 저장 = **경로 참조만** (B1, ADR 0052 SSH key 선례) — 복제 미채택 (질문 4).
- wallet password = **`password_enc` 계약** (ADR 0005/0040) + IPC 마스킹 + 3-state
  (질문 5).
- wallet 디렉토리 권한 느슨 시 **경고** (hard-fail 아님, 질문 6).
- export envelope 에서 **wallet 경로 strip** (DuckDB `io.rs` 선례, 질문 7).
- wallet 형식 = **`ewallet.pem` 단독** + openssl 변환 가이드 (경고 문구 필수, 질문 8).
- `trust_server_certificate` 류 "검증 끄기" **Oracle 미노출** (crate `verify_server`
  no-op → D1, 질문 9).
- 에러 redact 확장 (wallet 경로·descriptor·DN) — #1453 병행 (질문 11, §5-E).
- 배포 묶음: **#1072 (full adapter 승격) 와 같은 버전대** (질문 13).

**후속 이슈**: #1650 (Oracle 1-way TLS — TCPS + CA cert, advanced TLS #1649 CA 지원과
묶음).
