---
title: 연결 폼 TLS 노출 parity — threat-model handoff (#1063)
type: threat-model-handoff
issue: "#1063"
updated: 2026-07-17
status: decisions locked 2026-07-17
---

# 연결 폼 TLS 노출 parity — threat-model handoff (#1063)

Grill(소유자 결정 인터뷰) 진입 전 informed consent 용 임시 산출물.
`.agents/skills/grill-with-memory/SKILL.md` 보안 결정 6섹션 형식.

**이슈 스냅샷과 현행 코드의 차이 (2026-07-02 → 현재)**: 이슈가 "pg 0단"으로
기록했으나 이후 #1062(백엔드 결선) + #1526(PG 폼 토글)이 머지됨. 현행:

| 수준 | 엔진 | 근거 |
|---|---|---|
| 0단 (컨트롤 없음) | mysql/mariadb (`MysqlFormFields.tsx:6-7` "SSL reserved for future"), oracle (`src-tauri/src/db/oracle.rs:193-195` TLS 요청 자체를 hard-reject, #904) | 폼 |
| 1단 (boolean) | mongo (`MongoFormFields.tsx:190-194`), redis/valkey (`RedisFormFields.tsx:177-184`), es/os (`SearchFormFields.tsx:127-130`) | 폼 |
| 2단 (TLS + trustServerCertificate) | mssql (`MssqlFormFields.tsx:193-222`), **pg** (`PgFormFields.tsx:160-201`, #1526) | 폼 |

sslmode 세분화(disable/prefer/require/verify-ca/verify-full), CA 인증서,
클라이언트 인증서는 여전히 전 DBMS 부재. 선행 #1062 는 pg/mysql 결선 완료
(`src-tauri/src/db/tls.rs`), 단 mysql 은 UI 미노출이라 도달 불가.

## 1. 자산

- **DB 자격증명 (전송 중)** — TLS 부재/다운그레이드 시 네트워크 경로에서 평문
  또는 MITM 로 탈취. 탈취 = DB 전체 read/write 권한.
- **쿼리/결과 데이터 (전송 중)** — 사용자 SQL literal 에 PII/secret 이 일상적으로
  들어감 (ADR 0036 의 신뢰 모델 근거와 동일).
- **연결 무결성** — MITM 이 결과 위조/쿼리 변조 가능 (read 도청보다 넓은 위협).
- **저장된 연결 설정** — SQLite `connections` 테이블. `password_enc` 만 암호문,
  나머지 컬럼 (`tls_enabled`, `trust_server_certificate` 포함) 평문
  (`src-tauri/src/storage/reconcile.rs:264-292`).
- **(미래) 클라이언트 인증서 개인키 + passphrase** — 도입 시 password 와 동급
  secret 클래스.
- **사용자의 보안 멘탈 모델** — "TLS 켰다 = 안전하다" 라는 믿음 자체가 자산.
  어휘 비대칭·잘못된 기본값이 이 자산을 조용히 훼손.

## 2. 위협

- **수동 도청** — 경로상 스니핑. TLS off / oracle(평문 강제) / mysql(UI 부재)
  에서 상시 성립.
- **능동 MITM — downgrade strip** — `sslmode=prefer` 류 기회적 암호화는 능동
  공격자가 평문 협상을 강제 가능. pg/mysql 의 TLS 미설정 기본이 이 상태
  (`tls.rs:1-11` 주석이 명시한 #1062 원 동기).
- **능동 MITM — 인증서 치환** — 암호화는 되나 검증 생략(`trustServerCertificate
  =true`, redis `insecure`, mongo `allow_invalid_certificates` 류) 시 공격자
  인증서로 종단 위장 → 자격증명+데이터 전부 노출. **현행 mssql 신규 기본값이
  정확히 이 자세** (아래 §3).
- **내부 실수** — dev 용 trust=true 설정이 prod 연결로 복제; 폼 dbType 전환
  carryover (과거 실제 버그 — `model.ts:270-280` 주석의 "pre-fix MSSQL→RDB
  carryover"); URL 붙여넣기 시 보안 파라미터 조용한 유실.
- **로컬 파일 위협 (미래 인증서)** — 사용자 쓰기 가능 경로의 CA 파일 바꿔치기
  (TOCTOU), export envelope 를 통한 경로/파일시스템 레이아웃 노출.
- **사이드채널/supply-chain** — rustls/tiberius/reqwest 등 TLS 스택 의존성.
  본 이슈 범위 밖이나, 검증 로직을 앱이 자작하지 않고 드라이버에 위임하는
  현행 방침이 완화책.

## 3. 현재 인프라 정밀 분석

**공통 결정 경로** — `src-tauri/src/db/tls.rs` `resolve_tls_decision()`:
`(tls_enabled, trust)` → `Default | RequireSkipVerify | RequireVerifyFull`.
불가 조합 (`tls=true, trust=None` / `tls=false, trust=true`) 은 조용한 무시가
아닌 Validation 거부. pg/mysql 어댑터가 이를 소비.

| 엔진 | 백엔드 | TLS on 자세 | 기본(미설정) 자세 |
|---|---|---|---|
| pg | `PgSslMode::Require/VerifyFull` (`postgres/connection.rs:107-119`) | verify-full 또는 skip-verify | **driver `Prefer`** — 기회적, strip 가능 |
| mysql/mariadb | `MySqlSslMode::Required/VerifyIdentity` (`mysql/connection.rs:94-106`) | (UI 도달 불가) | **driver `Preferred`** — 전 사용자 상시 |
| mssql | tiberius `EncryptionLevel::Required` + `trust_cert()`; off 시 `NotSupported` (`mssql.rs:154-175`) | required+verify 또는 required+trust | **tls=true, trust=true = skip-verify** |
| oracle | TLS/wallet hard-reject (`oracle.rs:193-195`, #904) | — | 평문 강제 |
| mongo | `Tls::Enabled(TlsOptions::default())` (`mongodb/connection.rs:98-100`) | verify-full 만 | off |
| redis/valkey | `TcpTls { insecure: false, tls_params: None }` (`redis/helpers.rs:88-96`) | verify-full 만 | off; `rediss:` URL → on |
| es/os | scheme http↔https (`search_http.rs:512-517`), reqwest 기본 검증 | verify-full 만 | off (http) |

**mssql skip-verify 기본의 소스 3곳**:
- 폼: `MssqlFormFields.tsx:199` `checked={draft.tlsEnabled ?? true}` +
  `useConnectionDraftForm.ts:142` dbType 전환 시 `trustServerCertificate:
  dbType === "mssql" ? true : null`.
- URL 파서: `model.ts:432-441` `encrypt`/`trustServerCertificate` 둘 다
  default `true`.
- 편집 진입: `resolveDraftTlsEnabled()` (`model.ts:349-358`) mssql
  `tlsEnabled ?? true`.

**URL 파싱의 보안 파라미터 유실** (`model.ts:387-462`): `rediss:` scheme 과
mssql `encrypt`/`trustServerCertificate` 만 존중. pg `?sslmode=verify-full`,
mongo `?tls=true`, mysql `?ssl-mode=REQUIRED` 는 **조용히 폐기** → 사용자는
원본 URL 의 보안 자세가 유지된다고 오인.

**프론트 상태 계약** (`model.ts:258-293` `TLS_TOGGLE_DATABASE_TYPES`):
mssql/mongo/redis/valkey/es/os 만 멤버. pg 는 의도적으로 제외 — `tls=true,
trust=None` 잔재를 편집 진입 시 null 로 치유. 1단 엔진의 `tls=true,
trust=None` 은 **합법 저장 상태** — 통일 모델 도입 시 이 값의 재해석 규칙이
다운그레이드 여부를 가른다 (§5d).

**자격증명 저장 계약 (관련 ADR)**:
- ADR 0005 — plaintext password 는 IPC 경계를 넘지 않음 (serialize 시 마스킹).
- ADR 0040 — master file-key 는 OS keyring, ciphertext 는 SQLite
  `password_enc`. Threat 1(offline disk) 보호, Threat 2(실행 중 malware) 비보호.
- ADR 0021 — export 는 BIP39 mnemonic envelope (Argon2id m=64MiB,t=3,p=4).
- ADR 0036 — telemetry 0: TLS 설정/인증서 경로가 외부로 나가는 유일한 경로는
  사용자 자발적 export 뿐.
- ADR 0052 — SSH 터널 TOFU host key 핀 + keyring 봉투 재사용. **self-signed
  서버 신뢰의 기존 선례 어휘** — trust boolean 의 대안으로 인용 가능.

## 4. 사용자 실수 시나리오

1. **dev 습관의 prod 전이** — self-signed dev 에서 trust=true 로 저장 → 연결
   복제/편집으로 prod 에 그대로. 폼상 "TLS 켜짐" 체크만 보고 안전 오인.
2. **URL 붙여넣기** — 클라우드 벤더가 준 `?sslmode=verify-full` URL 붙여넣기
   → 파라미터 유실 → Prefer 로 접속되나 UI 는 아무 경고 없음.
3. **self-signed 실패 → TLS off** — 1단 엔진(mongo/redis/search)은 verify-full
   단일이라 self-signed 서버는 무조건 실패 → 사용자가 TLS 자체를 꺼버림
   (skip-verify 보다 나쁜 결과로의 행동 유도).
4. **(미래) 인증서 경로 실수** — repo 안 상대경로의 키 파일 참조 → repo 째
   commit; envelope + mnemonic 를 Slack 으로 함께 공유 → 경로/레이아웃 노출;
   절대경로 import 를 다른 머신에서 → 연결 실패 → TLS off 로 우회.
5. **dbType 전환 잔재** — 새 TLS 필드(CA 경로 등) 추가 시 carry/reset 매트릭스
   누락이면 과거 carryover 버그 재연 (엔진 A 의 신뢰 설정이 엔진 B 로 이월).

## 5. 완화 — 설계 선택지별 대응

### 5a. 공통 TLS 어휘 (이슈 수용 기준의 핵심 결정)

- **A. 최소공배수 2필드** (`tlsEnabled` + `trustServerCertificate` 전 엔진):
  기술 축 — mongo(`allow_invalid_certificates`)/redis(`insecure:true`)/
  search(`danger_accept_invalid_certs`) 매핑 존재, 구현 최소, `tls.rs` 재사용.
  유저 축 — 어휘 단일화로 멘탈 모델 회복, 시나리오 3 완화. **비용: skip-verify
  옵션이 전 엔진에 노출** = MITM 허용 자세의 표면 확대. prefer/verify-ca
  뉘앙스 표현 불가, 후속 sslmode 확장 시 boolean→enum 마이그레이션 필요.
- **B. 공통 sslmode enum superset** (disable/require/verify-ca/verify-full,
  엔진별 미지원 값은 #1046 규약 = hidden, not click-then-error): 기술 축 —
  매핑 비대칭 (tiberius 는 verify-ca/full 구분 없음, mongo/redis 도 chain-only
  검증 분리 곤란), 구현·테스트 비용 최대. 유저 축 — pg 사용자 어휘와 일치,
  CA 필드와 자연 결합 (verify-ca ↔ CA file).
- **C. 공통 core(A) + 엔진별 advanced 섹션 후속** — 이슈의 breadth-first P2
  문구와 일치. 비용: 두 어휘의 공존 기간 관리.

### 5b. 검증 수준별 위협 사다리 (sslmode 세분화 시)

| 수준 | 수동 도청 | 능동 strip | 인증서 치환 MITM | 비고 |
|---|---|---|---|---|
| disable | 노출 | — | — | oracle 현행 |
| prefer | 조건부 방어 | **노출** | **노출** | pg/mysql 미설정 기본 |
| require+skip-verify (trust=true) | 방어 | 방어 | **노출** | mssql 신규 기본 |
| verify-ca | 방어 | 방어 | 같은 CA 내 hostname 치환 잔존 | |
| verify-full | 방어 | 방어 | 방어 | 1단 엔진 on 자세 |

trust 류 옵션은 "수동 도청만 막으면 되는 사설망 self-signed" 라는 실수요가
있으나, UI 가 이를 기본값·무경고로 주면 사다리 3단 아래로의 조용한
다운그레이드가 된다. 완화: (a) skip-verify 는 명시 opt-in + 폼 내 경고 문구,
(b) ADR 0052 식 TOFU 인증서 핀으로 self-signed 수요를 검증 있는 경로로 흡수.

### 5c. CA/클라이언트 인증서 파일 경로 위협면 (후속 버전 대비)

- **경로 저장** — SQLite 평문 컬럼이 자연 위치 (경로는 secret 아님). 단 export
  envelope 포함 여부는 별도 결정: 포함 시 파일시스템 레이아웃/사용자명 노출 +
  cross-machine 절대경로 파손, 미포함 시 import 후 재설정 부담.
- **참조 vs 복사** — 참조: 원본 회전 자동 반영 + 개인키 사본 확산 없음, 대신
  사용자-쓰기 경로의 파일 치환(TOCTOU)·이동 파손. 복사(app data dir): 치환
  방어 + 이동 내성, 대신 회전 시 stale + 개인키 사본이 앱 폴더에 증식.
- **클라이언트 키 passphrase** — 새 secret 클래스. ADR 0005(IPC 미월경) +
  `password_enc` 계약(file-key 암호화 저장, ADR 0040) 동일 적용이 기존 계약과
  정합. keyring 별도 entry 는 계약 이원화라 비권장.
- **키 파일 권한** — 앱이 저장하지 않는 사용자 소유 파일. 연결 시 perm 검사
  (0o600 초과 시 경고) 도입 여부는 결정 사항.
- **backend 임의 경로 read** — Rust 백엔드가 직접 읽으므로 Tauri fs scope
  무관. config 조작 가능한 공격자에게 새 read 프리미티브가 생기나 파일 내용이
  외부로 나가지 않아 (핸드셰이크 재료로만 소비) 실질 위험 낮음.

### 5d. 기본값과 조용한 다운그레이드

확인된 벡터와 완화:

1. **pg/mysql 미설정 = Prefer** — 레거시 호환용 의도적 보존 (`tls.rs:26-28`).
   완화 후보: 폼 힌트 유지(현행 `tlsHintPg`) / 신규 연결만 verify-full 기본 /
   전면 강제(기존 연결 파손 위험).
2. **mssql 신규 기본 trust=true** — "암호화됨" 표시가 MITM 방어 0. 완화 후보:
   기본 trust=false 전환(자가서명 mssql 사용자 연결 실패 트레이드오프) /
   trust=true 유지 + 폼 경고.
3. **URL 파라미터 유실** — sslmode/tls/ssl-mode 존중 또는 최소 "무시됨" 고지.
4. **1단 엔진 저장값 `tls=true, trust=None` 재해석** — 통일 모델이 이를
   skip-verify 로 매핑하면 기존 사용자 일괄 다운그레이드. **verify-full 고정
   매핑이 안전측** (현행 실동작과 동일해 파손 0).
5. **dbType 전환 carry 매트릭스** — 새 필드마다 carry/reset 명시 (기존
   `TLS_TOGGLE_DATABASE_TYPES` 패턴 확장).
6. **구 export envelope import** — 필드 부재 시 기본값 해석이 사다리 아래로
   떨어지지 않게 import 경로에서 동일 규칙 적용.

## 6. 잔여 위험 (소유자가 수용해야 할 트레이드오프)

- **어느 옵션이든 skip-verify 가 존재하는 한** 사용자가 스스로 MITM 허용
  자세를 고를 수 있다 — UI 는 경고까지만, 차단은 불가 (로컬 도구 자율성 원칙).
- **verify-full 도 OS trust store 신뢰가 전제** — 머신에 심긴 악성 root CA 는
  방어 범위 밖 (ADR 0040 Threat 2 와 동일 논리: 실행 중 malware 급 권한은
  어떤 옵션도 못 막음).
- **기본값 강화 = 기존 연결 파손** — Prefer→verify-full, trust=true→false 류
  전환은 self-signed/구형 서버 사용자에게 즉시 연결 실패로 나타난다. 파손
  없는 경로는 "신규만 강화 + 기존은 편집 시 안내" 뿐이며, 그 기간 동안 기존
  연결의 다운그레이드 자세는 잔존.
- **oracle 은 parity 대상에서 빠짐** (#904 hard-reject) — 평문 강제가 명시
  에러로 드러나는 상태가 당분간 지속.
- **1차 breadth-first (boolean+trust 통일) 선택 시** sslmode 뉘앙스·인증서
  수요는 후속까지 미충족 — 그 사이 self-signed 사용자의 TLS-off 행동 유도
  위험(§4-3)은 trust 옵션 노출로만 부분 완화.

## Grill 결정 질문 (1줄 1결정)

1. 공통 어휘 축: A 최소공배수 2필드 / B sslmode enum superset / C core+후속 advanced 중 무엇으로 가는가?
2. skip-verify(trust) 옵션을 1단 엔진(mongo/redis/valkey/es/os)에도 노출하는가, verify-full 단일을 유지하는가?
3. mssql 신규 연결 기본 `trust=true`(skip-verify) 를 유지하는가, verify 기본으로 바꾸는가 (기존 self-signed 사용자 연결 실패 감수)?
4. pg/mysql 의 TLS 미설정 = driver Prefer 기본을 유지하는가, 신규 연결부터 명시 선택/verify-full 을 강제하는가?
5. mysql/mariadb 폼 TLS 컨트롤 노출을 이번 parity 범위에 포함하는가 (백엔드는 이미 결선, UI 만 부재)?
6. oracle 은 #904 hard-reject 유지로 parity 범위에서 제외함을 명문화하는가?
7. CA/클라이언트 인증서는 이슈 문구대로 후속 버전 확정인가, 이번 범위에 CA 파일만이라도 당기는가?
8. URL 붙여넣기에서 `sslmode`/`tls`/`ssl-mode` 파라미터를 존중하는가, 최소한 "무시됨" 고지를 넣는가?
9. 1단 엔진의 저장값 `tls=true, trust=None` 은 통일 모델에서 verify-full 고정 매핑으로 확정하는가?
10. self-signed 수요를 trust boolean 대신 ADR 0052 식 TOFU 인증서 핀으로 흡수하는 방향을 검토하는가?
11. (인증서 도입 시) 파일은 참조(경로 저장)인가 복사(app data dir)인가?
12. (인증서 도입 시) 클라이언트 키 passphrase 는 `password_enc` 동일 계약(ADR 0005/0040)으로 저장하는가?
13. (인증서 도입 시) export envelope 에 인증서 경로를 포함하는가?

## 결정 (2026-07-17 grill)

오너 grill 에서 아래를 lock 했다. 본문 §1~6 분석은 무수정 보존. 결정 1~4 의
근거·트레이드오프는 [ADR 0053](../archives/decisions/0053-connection-tls-core-vocabulary-warning-first-defaults/memory.md) 이 동결한다.

1. **공통 어휘 (§5a)** — core 2필드 (`tlsEnabled` + `trustServerCertificate`) 를 전
   엔진 통일한다. 추가로 **pg/mysql 은 sslmode enum (`disable`/`prefer`/`require`/
   `verify-full`) 을 이번 범위에 포함**한다. `verify-ca` 는 CA 파일과 함께 후속.
   CA·클라이언트 인증서·1단 엔진 enum 확장·TOFU 인증서 핀 검토 등 advanced depth 는
   후속 #1649 로 분리 (질문 1·7·10 = 옵션 C core+후속 advanced).
2. **mssql 신규 기본 (§5d-2)** — `trust=true` (skip-verify) 유지 + **폼 경고 문구**.
   verify 기본 전환은 자가서명 mssql 사용자 연결 파손 위험이라 미채택, 잔여 위험을
   경고로 노출하고 수용 (질문 3).
3. **pg/mysql 미설정 = Prefer 유지 (§5d-1)** + **폼 힌트** (mysql 에도 pg 와 동일
   적용). 전면 verify-full 강제는 기존 연결 파손이라 미채택 (질문 4·5 — mysql UI 노출은
   이번 parity 범위 포함).
4. **URL 붙여넣기 (§5d-3)** — `sslmode`/`tls`/`ssl-mode` 파라미터를 존중하고, 매핑
   불가 값은 "반영되지 않음" 고지 (질문 8).

**파생 결정**:

- 1단 엔진 (mongo/redis/valkey/es/os) 에 trust (skip-verify) 노출 — **명시 opt-in +
  폼 경고** (질문 2 — self-signed TLS-off 행동 유도 완화).
- oracle 은 #904 hard-reject 로 parity 범위 제외 명문화 — TLS 는 #1065 소관 (질문 6).
- 1단 엔진 저장값 `tls=true, trust=None` 은 **verify-full 고정 매핑** (현행 실동작과
  동일, 다운그레이드 0 — 질문 9).
- dbType 전환 carry/reset 매트릭스를 새 TLS 필드마다 확장 (`TLS_TOGGLE_DATABASE_TYPES`
  패턴, §5d-5).

**후속 이슈**: #1649 (advanced TLS depth-step — CA 파일·클라이언트 인증서·1단 엔진
sslmode 확장·TOFU 인증서 핀 검토, §5c 위협면).
