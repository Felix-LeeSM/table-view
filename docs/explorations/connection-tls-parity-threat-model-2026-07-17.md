---
title: "연결 폼 TLS 노출 parity: threat-model handoff (#1063)"
type: threat-model-handoff
issue: "#1063"
updated: 2026-07-17
status: decisions locked 2026-07-17
---

# 연결 폼 TLS 노출 parity: threat-model handoff (#1063)

Grill(소유자 결정 인터뷰)에 진입하기 전에 informed consent 를 확보하려고 만든
임시 산출물이다. 아래 6개 절은 당시 보안 결정 문서 형식을 따랐다.

**이슈 스냅샷과 현행 코드의 차이 (2026-07-02 → 현재)**: 이슈는 "pg 0단"으로
기록했으나, 그 뒤에 #1062(백엔드 결선)와 #1526(PG 폼 토글)이 머지되었다. 현행
상태는 다음과 같다:

| 수준 | 엔진 | 근거 |
|---|---|---|
| 0단 (컨트롤 없음) | mysql/mariadb (`MysqlFormFields.tsx:6-7` "SSL reserved for future"), oracle (`src-tauri/table-view-core/src/db/oracle.rs:193-195` TLS 요청 자체를 hard-reject, #904) | 폼 |
| 1단 (boolean) | mongo (`MongoFormFields.tsx:190-194`), redis/valkey (`RedisFormFields.tsx:177-184`), es/os (`SearchFormFields.tsx:127-130`) | 폼 |
| 2단 (TLS + trustServerCertificate) | mssql (`MssqlFormFields.tsx:193-222`), **pg** (`PgFormFields.tsx:160-201`, #1526) | 폼 |

sslmode 세분화(disable/prefer/require/verify-ca/verify-full)와 CA 인증서,
클라이언트 인증서는 여전히 모든 DBMS 에 없다. 선행 이슈인 #1062 가 pg/mysql
백엔드 결선을 완료했으나(`src-tauri/table-view-core/src/db/tls.rs`), mysql 은
UI 에 노출되지 않아서 사용자가 도달할 수 없다.

## 1. 자산

- **DB 자격증명 (전송 중)**: TLS 가 없거나 다운그레이드되면 네트워크 경로에서
  평문으로 노출되거나 MITM 공격으로 탈취된다. 탈취당하면 공격자가 DB 전체의
  read/write 권한을 얻는다.
- **쿼리/결과 데이터 (전송 중)**: 사용자가 작성하는 SQL literal 에 PII 나
  secret 이 일상적으로 들어간다 (ADR 0036 이 제시한 신뢰 모델 근거와 같다).
- **연결 무결성**: MITM 공격자가 결과를 위조하거나 쿼리를 변조할 수 있다
  (read 도청보다 범위가 넓은 위협이다).
- **저장된 연결 설정**: SQLite `connections` 테이블에 저장한다. `password_enc`
  만 암호문이고, `tls_enabled` 와 `trust_server_certificate` 를 포함한 나머지
  컬럼은 평문이다
  (`src-tauri/table-view-core/src/storage/reconcile.rs:264-292`).
- **(미래) 클라이언트 인증서 개인키와 passphrase**: 도입하면 password 와
  동등한 secret 클래스로 취급해야 한다.
- **사용자가 지닌 보안 멘탈 모델**: "TLS 를 켰으니 안전하다" 라는 믿음 자체가
  보호해야 할 자산이다. 엔진마다 어휘가 비대칭이거나 기본값이 잘못되어 있으면
  이 자산이 사용자 모르게 훼손된다.

## 2. 위협

- **수동 도청**: 공격자가 네트워크 경로에서 패킷을 스니핑한다. TLS 를 끈 연결,
  평문을 강제하는 oracle, UI 가 없는 mysql 에서 상시 성립한다.
- **능동 MITM(downgrade strip)**: `sslmode=prefer` 처럼 기회적으로 암호화하는
  방식은 능동 공격자가 평문 협상을 강제할 수 있다. pg/mysql 에서 TLS 를
  설정하지 않은 기본 상태가 여기에 해당하며, `tls.rs:1-11` 주석이 이를
  #1062 의 원래 동기로 명시한다.
- **능동 MITM(인증서 치환)**: 암호화는 이루어지지만 검증을 생략하는
  설정(`trustServerCertificate
  =true`, redis `insecure`, mongo `allow_invalid_certificates` 등)을 쓰면
  공격자가 자기 인증서로 종단을 위장하므로 자격증명과 데이터가 전부 노출된다.
  **현행 mssql 신규 기본값이 정확히 이 상태이다** (아래 §3).
- **내부 실수**: dev 용으로 설정한 trust=true 가 prod 연결로 복제되거나, 폼에서
  dbType 을 전환할 때 값이 carryover 된다 (과거에 실제로 발생한 버그이며,
  `model.ts:270-280` 주석이 "pre-fix MSSQL→RDB carryover" 로 기록한다). URL 을
  붙여넣을 때 보안 파라미터가 사용자 모르게 유실되기도 한다.
- **로컬 파일 위협 (미래 인증서)**: 사용자가 쓸 수 있는 경로에 있는 CA 파일을
  공격자가 바꿔치기하거나(TOCTOU), export envelope 로 경로와 파일시스템
  레이아웃이 노출된다.
- **사이드채널과 supply-chain**: rustls/tiberius/reqwest 등 TLS 스택 의존성에서
  발생한다. 이 이슈의 범위 밖이지만, 검증 로직을 앱이 직접 구현하지 않고
  드라이버에 위임하는 현행 방침이 완화책으로 작용한다.

## 3. 현재 인프라 정밀 분석

**공통 결정 경로**: `src-tauri/table-view-core/src/db/tls.rs` 의
`resolve_tls_decision()` 이 `(tls_enabled, trust)` 를
`Default | RequireSkipVerify | RequireVerifyFull` 로 변환한다. 성립할 수 없는
조합(`tls=true, trust=None` 과 `tls=false, trust=true`)은 조용히 무시하지 않고
Validation 오류로 거부한다. pg/mysql 어댑터가 이 결과를 소비한다.

| 엔진 | 백엔드 | TLS on 자세 | 기본(미설정) 자세 |
|---|---|---|---|
| pg | `PgSslMode::Require/VerifyFull` (`postgres/connection.rs:107-119`) | verify-full 또는 skip-verify | **driver `Prefer`**: 기회적이라 strip 가능 |
| mysql/mariadb | `MySqlSslMode::Required/VerifyIdentity` (`mysql/connection.rs:94-106`) | (UI 도달 불가) | **driver `Preferred`**: 전 사용자에게 상시 적용 |
| mssql | tiberius `EncryptionLevel::Required` + `trust_cert()`; off 시 `NotSupported` (`mssql.rs:154-175`) | required+verify 또는 required+trust | **tls=true, trust=true = skip-verify** |
| oracle | TLS/wallet hard-reject (`oracle.rs:193-195`, #904) | 해당 없음 | 평문 강제 |
| mongo | `Tls::Enabled(TlsOptions::default())` (`mongodb/connection.rs:98-100`) | verify-full 만 | off |
| redis/valkey | `TcpTls { insecure: false, tls_params: None }` (`redis/helpers.rs:88-96`) | verify-full 만 | off; `rediss:` URL → on |
| es/os | scheme http↔https (`search_http.rs:512-517`), reqwest 기본 검증 | verify-full 만 | off (http) |

**mssql 이 skip-verify 를 기본값으로 갖게 만드는 소스 3곳**:
- 폼: `MssqlFormFields.tsx:199` 의 `checked={draft.tlsEnabled ?? true}` 와,
  dbType 을 전환할 때 적용하는 `useConnectionDraftForm.ts:142` 의 `trustServerCertificate:
  dbType === "mssql" ? true : null` 이 함께 작용한다.
- URL 파서: `model.ts:432-441` 에서 `encrypt` 와 `trustServerCertificate` 의
  default 가 둘 다 `true` 이다.
- 편집 진입: `resolveDraftTlsEnabled()` (`model.ts:349-358`) 가 mssql 에
  `tlsEnabled ?? true` 를 적용한다.

**URL 을 파싱할 때 보안 파라미터가 유실된다** (`model.ts:387-462`): `rediss:`
scheme 과 mssql 의 `encrypt`/`trustServerCertificate` 만 존중한다. pg 의
`?sslmode=verify-full`, mongo 의 `?tls=true`, mysql 의 `?ssl-mode=REQUIRED` 는
**조용히 폐기하므로**, 사용자는 원본 URL 이 지정한 보안 설정이 그대로
유지된다고 오인한다.

**프론트 상태 계약** (`model.ts:258-293` 의 `TLS_TOGGLE_DATABASE_TYPES`):
mssql/mongo/redis/valkey/es/os 만 멤버로 등록되어 있고, pg 는 의도적으로
제외했다. 편집 화면에 진입할 때 pg 에 남아 있던 `tls=true,
trust=None` 잔재를 null 로 정정하기 때문이다. 반면 1단 엔진에서는 `tls=true,
trust=None` 이 **합법적인 저장 상태**이므로, 통일 모델을 도입할 때 이 값을
어떻게 재해석하느냐가 다운그레이드 여부를 가른다 (§5d).

**자격증명 저장 계약 (관련 ADR)**:
- ADR 0005: plaintext password 는 IPC 경계를 넘지 않는다 (serialize 할 때
  마스킹한다).
- ADR 0040: master file-key 는 OS keyring 에 두고, ciphertext 는 SQLite 의
  `password_enc` 에 저장한다. Threat 1(offline disk)은 보호하지만
  Threat 2(실행 중 malware)는 보호하지 않는다.
- ADR 0021: export 는 BIP39 mnemonic envelope 를 사용한다
  (Argon2id m=64MiB,t=3,p=4).
- ADR 0036: telemetry 를 0 으로 유지하므로, TLS 설정과 인증서 경로가 외부로
  나가는 유일한 경로는 사용자가 자발적으로 실행하는 export 뿐이다.
- ADR 0052: SSH 터널에서 TOFU host key 핀과 keyring 봉투 재사용을 채택했다.
  **self-signed 서버를 신뢰하는 기존 선례이자 어휘**이므로, trust boolean 의
  대안으로 인용할 수 있다.

## 4. 사용자 실수 시나리오

1. **dev 습관이 prod 로 이어진다**: self-signed 인증서를 쓰는 dev 환경에서
   trust=true 로 저장한 뒤, 연결을 복제하거나 편집해서 prod 에 그대로 쓴다.
   사용자는 폼에 표시된 "TLS 켜짐" 체크만 보고 안전하다고 오인한다.
2. **URL 붙여넣기**: 클라우드 벤더가 제공한 `?sslmode=verify-full` URL 을
   붙여넣으면 파라미터가 유실되어 Prefer 로 접속되지만, UI 는 아무 경고도
   표시하지 않는다.
3. **self-signed 연결이 실패하면 TLS 를 꺼 버린다**: 1단
   엔진(mongo/redis/search)은 verify-full 만 지원하므로 self-signed 서버에는
   무조건 접속이 실패하고, 그러면 사용자가 TLS 자체를 꺼 버린다 (skip-verify
   보다 나쁜 결과로 사용자를 유도하는 셈이다).
4. **(미래) 인증서 경로 실수**: repo 안의 상대경로로 키 파일을 참조하면 키가
   repo 에 통째로 commit 된다. envelope 와 mnemonic 를 Slack 으로 함께
   공유하면 경로와 파일시스템 레이아웃이 노출된다. 절대경로를 담은 설정을
   다른 머신에서 import 하면 연결이 실패하고, 사용자는 TLS 를 꺼서 우회한다.
5. **dbType 전환 잔재**: 새 TLS 필드(CA 경로 등)를 추가할 때 carry/reset
   매트릭스를 빠뜨리면 과거의 carryover 버그가 재연된다 (엔진 A 의 신뢰
   설정이 엔진 B 로 이월된다).

## 5. 완화: 설계 선택지별 대응

### 5a. 공통 TLS 어휘 (이슈 수용 기준에서 핵심이 되는 결정)

- **A. 최소공배수 2필드** (`tlsEnabled` 와 `trustServerCertificate` 를 전 엔진에
  적용): 기술 측면에서는 mongo(`allow_invalid_certificates`),
  redis(`insecure:true`), search(`danger_accept_invalid_certs`) 에 대응하는
  매핑이 이미 있어서 구현량이 가장 적고 `tls.rs` 를 재사용한다. 사용자
  측면에서는 어휘를 하나로 통일해서 멘탈 모델을 회복시키고 시나리오 3 을
  완화한다. **비용은 skip-verify 옵션이 전 엔진에 노출된다는 점**이며, 이는
  MITM 을 허용하는 설정의 표면이 넓어진다는 뜻이다. prefer 와 verify-ca 의
  뉘앙스는 표현할 수 없고, 나중에 sslmode 로 확장할 때 boolean 에서 enum 으로
  마이그레이션해야 한다.
- **B. 공통 sslmode enum superset** (disable/require/verify-ca/verify-full 이며,
  엔진이 지원하지 않는 값은 #1046 규약에 따라 hidden 으로 두고
  click-then-error 를 쓰지 않는다): 기술 측면에서는 매핑이 비대칭이고
  (tiberius 는 verify-ca 와 verify-full 을 구분하지 않으며, mongo 와 redis 도
  chain-only 검증만 떼어 내기 어렵다) 구현과 테스트 비용이 가장 크다. 사용자
  측면에서는 pg 사용자가 쓰는 어휘와 일치하고, CA 필드와 자연스럽게
  결합한다 (verify-ca 가 CA file 과 짝을 이룬다).
- **C. 공통 core(A) 를 먼저 적용하고 엔진별 advanced 섹션은 후속으로 미룬다**:
  이슈에 적힌 breadth-first P2 문구와 일치한다. 비용은 두 어휘가 공존하는
  기간을 관리해야 한다는 점이다.

### 5b. 검증 수준에 따른 위협 노출 (sslmode 를 세분화할 경우)

| 수준 | 수동 도청 | 능동 strip | 인증서 치환 MITM | 비고 |
|---|---|---|---|---|
| disable | 노출 | 해당 없음 | 해당 없음 | oracle 현행 |
| prefer | 조건부 방어 | **노출** | **노출** | pg/mysql 미설정 기본 |
| require+skip-verify (trust=true) | 방어 | 방어 | **노출** | mssql 신규 기본 |
| verify-ca | 방어 | 방어 | 같은 CA 내 hostname 치환 잔존 | |
| verify-full | 방어 | 방어 | 방어 | 1단 엔진 on 자세 |

trust 류 옵션에는 "사설망의 self-signed 서버라서 수동 도청만 막으면 된다" 라는
실제 수요가 있다. 그러나 UI 가 이 옵션을 기본값으로 주면서 경고도 붙이지 않으면,
사용자가 모르는 사이에 검증 수준이 위 표의 3단 아래로 내려가는 다운그레이드가
발생한다. 완화 방안은 다음과 같다. (a) skip-verify 를 명시적인 opt-in 으로
만들고 폼 안에 경고 문구를 붙인다. (b) ADR 0052 방식의 TOFU 인증서 핀으로
self-signed 수요를 검증이 있는 경로로 흡수한다.

### 5c. CA/클라이언트 인증서 파일 경로 위협면 (후속 버전 대비)

- **경로 저장**: 경로는 secret 이 아니므로 SQLite 의 평문 컬럼이 자연스러운
  저장 위치이다. 다만 export envelope 에 포함할지는 따로 결정해야 한다.
  포함하면 파일시스템 레이아웃과 사용자명이 노출되고 머신이 달라질 때
  절대경로가 깨지며, 포함하지 않으면 import 한 뒤에 다시 설정해야 하는 부담이
  생긴다.
- **참조와 복사 중 무엇을 택할 것인가**: 참조 방식은 원본을 회전하면 자동으로
  반영되고 개인키 사본이 퍼지지 않지만, 사용자가 쓸 수 있는 경로에서 파일이
  치환되거나(TOCTOU) 파일을 옮기면 참조가 깨진다. 복사 방식(app data dir 에
  복사)은 치환을 방어하고 파일 이동에도 견디지만, 원본을 회전하면 사본이
  stale 상태로 남고 개인키 사본이 앱 폴더에 늘어난다.
- **클라이언트 키 passphrase**: 새로운 secret 클래스에 해당한다. ADR 0005(IPC
  경계를 넘지 않음)와 `password_enc` 계약(file-key 로 암호화해 저장,
  ADR 0040)을 그대로 적용하는 편이 기존 계약과 정합한다. keyring 에 별도
  entry 를 두는 방식은 계약을 이원화하므로 권장하지 않는다.
- **키 파일 권한**: 앱이 저장하지 않고 사용자가 소유하는 파일이다. 연결할 때
  권한을 검사해서 0o600 을 초과하면 경고할지는 결정해야 할 사항이다.
- **backend 가 임의 경로를 read 하는 문제**: Rust 백엔드가 파일을 직접 읽으므로
  Tauri fs scope 와는 무관하다. config 를 조작할 수 있는 공격자에게 새로운
  read 프리미티브가 생기지만, 파일 내용이 외부로 나가지 않고 핸드셰이크
  재료로만 소비되므로 실질적인 위험은 낮다.

### 5d. 기본값과 조용한 다운그레이드

확인된 벡터와 완화 방안은 다음과 같다.

1. **pg/mysql 은 미설정 상태가 곧 Prefer 이다**: 레거시 호환을 위해 의도적으로
   보존한 동작이다 (`tls.rs:26-28`). 완화 후보로는 현행 `tlsHintPg` 같은 폼
   힌트를 유지하는 방안, 신규 연결에만 verify-full 을 기본값으로 주는 방안,
   전면 강제해서 기존 연결이 파손될 위험을 감수하는 방안이 있다.
2. **mssql 신규 연결의 기본값이 trust=true 이다**: "암호화됨" 이라고 표시되지만
   MITM 방어 효과는 0 이다. 완화 후보로는 기본값을 trust=false 로 바꾸어
   자가서명 인증서를 쓰는 mssql 사용자의 연결 실패를 감수하는 방안과,
   trust=true 를 유지하면서 폼에 경고를 붙이는 방안이 있다.
3. **URL 파라미터 유실**: sslmode 와 tls, ssl-mode 를 존중하거나, 최소한
   "무시됨" 이라고 고지해야 한다.
4. **1단 엔진에 저장된 `tls=true, trust=None` 을 어떻게 재해석할 것인가**: 통일
   모델이 이 값을 skip-verify 로 매핑하면 기존 사용자가 일괄로 다운그레이드된다.
   **verify-full 로 고정 매핑하는 편이 안전하다** (현행 실동작과 같아서 파손이
   0 이다).
5. **dbType 전환 carry 매트릭스**: 새 필드를 추가할 때마다 carry 와 reset 을
   명시해야 한다 (기존 `TLS_TOGGLE_DATABASE_TYPES` 패턴을 확장한다).
6. **예전 export envelope 를 import 하는 경우**: 필드가 없을 때 기본값 해석
   때문에 검증 수준이 낮아지지 않도록, import 경로에도 같은 규칙을 적용해야
   한다.

## 6. 잔여 위험 (소유자가 수용해야 할 트레이드오프)

- **어느 옵션을 고르든 skip-verify 가 존재하는 한** 사용자가 스스로 MITM 을
  허용하는 설정을 선택할 수 있다. UI 는 경고까지만 할 수 있고 차단하지는
  못한다 (로컬 도구의 자율성 원칙).
- **verify-full 도 OS trust store 를 신뢰한다는 전제 위에 있다**: 머신에 설치된
  악성 root CA 는 방어 범위 밖이다 (ADR 0040 의 Threat 2 와 같은 논리이며,
  실행 중인 malware 수준의 권한은 어떤 옵션으로도 막을 수 없다).
- **기본값을 강화하면 기존 연결이 파손된다**: Prefer 에서 verify-full 로,
  trust=true 에서 false 로 전환하면 self-signed 인증서나 구형 서버를 쓰는
  사용자에게 즉시 연결 실패로 나타난다. 파손이 없는 경로는 "신규 연결만
  강화하고 기존 연결은 편집할 때 안내한다" 뿐이며, 그 기간 동안 기존 연결은
  다운그레이드된 설정을 그대로 유지한다.
- **oracle 은 parity 대상에서 빠진다** (#904 hard-reject): 평문을 강제하는
  상태가 명시적인 에러로 드러나는 상황이 당분간 지속된다.
- **1차로 breadth-first 방안(boolean 과 trust 통일)을 선택하면** sslmode 의
  뉘앙스와 인증서 수요는 후속 작업까지 충족되지 않는다. 그 사이 self-signed
  사용자가 TLS 를 꺼 버리도록 유도되는 위험(§4-3)은 trust 옵션을 노출하는
  것만으로 부분적으로 완화된다.

## Grill 결정 질문 (1줄 1결정)

1. 공통 어휘 축을 A 최소공배수 2필드, B sslmode enum superset, C core+후속 advanced 중 어느 쪽으로 정하는가?
2. skip-verify(trust) 옵션을 1단 엔진(mongo/redis/valkey/es/os)에도 노출하는가, verify-full 단일 방식을 유지하는가?
3. mssql 신규 연결 기본값인 `trust=true`(skip-verify) 를 유지하는가, verify 기본으로 바꾸는가 (기존 self-signed 사용자의 연결 실패를 감수한다)?
4. pg/mysql 에서 TLS 미설정이 곧 driver Prefer 인 기본 동작을 유지하는가, 신규 연결부터 명시적 선택이나 verify-full 을 강제하는가?
5. mysql/mariadb 폼에 TLS 컨트롤을 노출하는 작업을 이번 parity 범위에 포함하는가 (백엔드는 이미 결선되었고 UI 만 없다)?
6. oracle 은 #904 hard-reject 를 유지하므로 parity 범위에서 제외한다고 명문화하는가?
7. CA·클라이언트 인증서는 이슈 문구대로 후속 버전으로 확정하는가, 이번 범위에 CA 파일만이라도 앞당기는가?
8. URL 붙여넣기에서 `sslmode`/`tls`/`ssl-mode` 파라미터를 존중하는가, 최소한 "무시됨" 고지를 넣는가?
9. 1단 엔진에 저장된 `tls=true, trust=None` 은 통일 모델에서 verify-full 고정 매핑으로 확정하는가?
10. self-signed 수요를 trust boolean 대신 ADR 0052 방식의 TOFU 인증서 핀으로 흡수하는 방향을 검토하는가?
11. (인증서를 도입할 때) 파일을 참조하는가(경로 저장), 복사하는가(app data dir)?
12. (인증서를 도입할 때) 클라이언트 키 passphrase 는 `password_enc` 와 동일한 계약(ADR 0005/0040)으로 저장하는가?
13. (인증서를 도입할 때) export envelope 에 인증서 경로를 포함하는가?

## 결정 (2026-07-17 grill)

오너 grill 에서 아래 결정을 lock 했다. 본문 §1~6 의 분석은 수정하지 않고
보존한다. 결정 1~4 의 근거와 트레이드오프는 [ADR 0053](../decisions/0053-connection-tls-core-vocabulary-warning-first-defaults/memory.md) 이 동결한다.

1. **공통 어휘 (§5a)**: core 2필드(`tlsEnabled` 와 `trustServerCertificate`)를 전
   엔진에 통일한다. 추가로 **pg/mysql 은 sslmode enum(`disable`/`prefer`/`require`/
   `verify-full`)을 이번 범위에 포함**한다. `verify-ca` 는 CA 파일과 함께 후속으로
   미룬다. CA 와 클라이언트 인증서, 1단 엔진 enum 확장, TOFU 인증서 핀 검토 같은
   advanced depth 는 후속 이슈 #1649 로 분리한다 (질문 1·7·10 에 해당하며,
   옵션 C 인 core+후속 advanced 를 택했다).
2. **mssql 신규 연결 기본값 (§5d-2)**: `trust=true` (skip-verify) 를 유지하고
   **폼 경고 문구**를 함께 넣는다. verify 를 기본값으로 전환하는 방안은 자가서명
   인증서를 쓰는 mssql 사용자의 연결을 파손할 위험이 있어서 채택하지 않았고, 잔여
   위험은 경고로 노출한 뒤 수용한다 (질문 3).
3. **pg/mysql 은 미설정 시 Prefer 를 유지한다 (§5d-1)**. 여기에 **폼 힌트**를
   더하며, mysql 에도 pg 와 똑같이 적용한다. verify-full 을 전면 강제하는 방안은
   기존 연결을 파손하므로 채택하지 않았다 (질문 4·5 에 해당하고, mysql UI 노출은
   이번 parity 범위에 포함한다).
4. **URL 붙여넣기 (§5d-3)**: `sslmode`/`tls`/`ssl-mode` 파라미터를 존중하고, 매핑할
   수 없는 값은 "반영되지 않음" 이라고 고지한다 (질문 8).

**파생 결정**:

- 1단 엔진(mongo/redis/valkey/es/os)에 trust(skip-verify)를 노출하되, **명시적인
  opt-in 과 폼 경고**를 함께 요구한다 (질문 2 에 해당하며, self-signed 서버 때문에
  TLS 를 꺼 버리는 행동을 완화한다).
- oracle 은 #904 hard-reject 때문에 parity 범위에서 제외한다고 명문화한다. oracle 의
  TLS 는 #1065 가 담당한다 (질문 6).
- 1단 엔진에 저장된 `tls=true, trust=None` 은 **verify-full 로 고정 매핑한다**
  (현행 실동작과 같아서 다운그레이드가 0 이다. 질문 9).
- dbType 전환 carry/reset 매트릭스를 새 TLS 필드마다 확장한다
  (`TLS_TOGGLE_DATABASE_TYPES` 패턴을 따르며, §5d-5 에 해당한다).

**후속 이슈**: #1649 (advanced TLS depth-step 으로, CA 파일과 클라이언트 인증서,
1단 엔진 sslmode 확장, TOFU 인증서 핀 검토를 다루며 §5c 의 위협면에 해당한다).
