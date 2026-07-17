---
title: SSH 터널 지원 (#1064) — Threat-Model Handoff
type: threat-model-handoff
issue: "#1064"
updated: 2026-07-17
status: pre-grill informed consent (임시 산출물 — decision lock 후 SOT 흡수)
related:
  - issue #1064 (SSH 터널 tracker)
  - issue #1453 (연결 에러 마스킹 갭)
  - issue #1056 (드라이버 에러 힌팅 레이어)
  - docs/archives/decisions/0052-ssh-tunnel-connection-scoped-tofu/memory.md
  - docs/archives/decisions/0040-file-key-os-keyring/memory.md
  - docs/archives/decisions/0005-plaintext-password-never-leaves-backend/memory.md
  - docs/archives/decisions/0021-export-envelope-auto-mnemonic-no-ttl/memory.md
  - docs/archives/decisions/0036-telemetry-zero-collection/memory.md
---

# SSH 터널 지원 (#1064) — Threat-Model Handoff (2026-07-17)

## 0. 선행 결정 상태 — 반드시 먼저 읽을 것

**ADR 0052 (Accepted 2026-07-10) 가 이미 존재한다.** 이슈 #1064 의
"착수 전 grill 권장" 항목 중 다음 6축은 2026-07-10 오너 grill 에서 이미 lock 됐다:

| 축 | 잠긴 결정 |
|---|---|
| Q1 인증 범위 | 1차 = password + key file(+passphrase). ssh-agent 후속 이월 |
| Q2 라이프사이클 | 연결별 터널 (#1100 원자 대칭 위). 공유 bastion refcount 후속 |
| Q3 라이브러리 | russh 계열 순수 Rust. **정확한 crate·버전은 구현 시 확정 (미결)** |
| Q4 host key | TOFU + 앱 관리 known_hosts(SQLite 영속) + 불일치 hard-fail. blind-accept 배제 |
| Q5 secret 저장 | 기존 keyring/master-key 봉투 재사용 (ADR 0040/0005). key 파일 내용 미저장·경로 참조, export 시 strip |
| Q6 에러 표면 | `AppError::SshTunnel` 분리 + redact + hint SSH 카테고리 (#1453 병행) |

따라서 본 handoff 의 역할은 두 가지다:

1. 잠긴 6축의 위협 근거를 informed-consent 수준으로 정리 (사후 보강).
2. **ADR 0052 가 열어둔 잔여 축** (로컬 포트 바인딩 노출면, crate/버전 확정,
   fingerprint 표기, 재핀 UX, TLS-over-tunnel 등) 의 grill 입력 제공.

잠긴 축을 재개봉하려면 ADR 본문 동결 규칙에 따라 **새 ADR + Supersede** 절차가
필요하다. 잠긴 축을 일반 options grill 로 다시 묻는 것은 인덱스 규칙 위반.

## 1. 자산 (보호 대상)

- **SSH 자격증명 (신규 secret)**: 터널 password, key passphrase.
- **SSH private key 파일**: 앱 밖 자산. 앱은 내용 미저장·경로만 참조 (Q5).
  경로 문자열 자체도 정보 자산 (사용자 홈 구조·키 위치 노출).
- **bastion 경유 내부망 도달권**: 터널이 열리는 순간 로컬 머신에 "방화벽 뒤
  DB 포트로 가는 통로"가 생긴다. 기존에 없던 자산 클래스.
- **host key 신뢰 앵커**: 앱 관리 known_hosts 핀. 오염되면 이후 MITM 을
  "정상"으로 통과시킨다.
- **DB 자격증명·쿼리·데이터** (기존 자산 — 터널 통과 트래픽).

## 2. 위협

**외부 공격**
- MITM: host key 미검증이면 SSH 암호화 주장 자체가 무효. TOFU 는 최초 연결
  시점 MITM 을 구조적으로 못 막는다 (ADR 0052 트레이드오프에 명시).
- SSH wire 파서: 신뢰 불가한 원격 입력을 파싱하는 코드. C 바인딩이면 FFI
  경계 + 메모리 안전성 위험 (Q3 에서 순수 Rust 로 배제).
- 프로토콜 다운그레이드: Terrapin (CVE-2023-48795) 류. strict-kex 대응
  버전 하한이 필요.

**로컬 공격 / 노출면**
- 로컬 포트 리스너 (미결 축): 터널을 `127.0.0.1:<ephemeral>` listener 로
  드라이버에 배선하면, listen 중 **같은 머신의 다른 프로세스/사용자**가 그
  포트로 접속해 사용자의 SSH 세션을 타고 내부망 DB 포트에 도달할 수 있다.
  DB 인증은 여전히 필요하지만 "방화벽 뒤 네트워크 도달권" 자체가 새어 나간다.
- 에러/로그 에코: russh 에러 문자열에 key 경로·fingerprint·사용자명이 섞여
  사이드바/로그로 새는 경로. 현행 `connection_redacted` 는 URI userinfo 와
  `password=`/`pwd=` 만 마스킹 (`src-tauri/src/error.rs:136`) — SSH 흔적은
  현재 redaction 범위 밖이다 (Q6 가 해소 대상).

**내부 실수**
- TOFU dialog fatigue: 사용자가 fingerprint 확인 없이 습관적 accept.
- TLS-over-tunnel 오설정: 터널 경유 시 드라이버가 `127.0.0.1` 로 접속하므로
  DB TLS 의 hostname 검증이 원래 host 와 충돌 — "검증 끄기"로 우회하는 실수 유도.

**Supply-chain**
- 신규 SSH crate 의존 추가. 현재 `src-tauri/Cargo.toml` 에 SSH 의존 0.
  cargo-deny gate (Cargo.toml 주석에 명시) 로 RUSTSEC advisory 지속 감시 필요.

**사이드채널**
- IPC 경계: SSH secret 이 프론트로 직렬화되면 ADR 0005 위반.
- 스크린샷/화면공유: fingerprint 표시는 비밀 아님 (안전). password 필드는
  기존 마스킹 관례.
- Telemetry: 해당 없음 — ADR 0036 수집 0 (SSH host/fingerprint 도 외부 송신 0).

## 3. 현재 인프라 정밀 분석

**암호화·저장 (재사용 대상 — 신규 매체 없음)**
- at-rest: AES-256-GCM, master file-key 는 OS keyring
  (`com.tableview.app.file-key`, `src-tauri/src/storage/crypto.rs:22`),
  Linux Secret Service 불가 시 disk fallback 0600 + probe retry 3×50ms
  (`crypto.rs:84–114`). ADR 0040 threat 1 (offline disk-access) 보호,
  threat 2 (running malware) 는 범위 밖 — SSH secret 도 동일 수용선.
- IPC: plaintext 는 백엔드 밖으로 안 나감 (ADR 0005).
  `list_connections` 는 password 필드 자체를 미포함
  (`src-tauri/src/commands/connection/crud.rs:388–408` 회귀 테스트).
- 3-state secret 편집: `Some(s)`=교체 / `None`=유지 / `Some("")`=삭제 —
  백엔드 `save_connection` (`crud.rs:415–490` 테스트) + 프론트
  `resolvePassword` (`src/features/connection/components/ConnectionDialog/useConnectionDraftForm.ts:174–183`).
  터널 password·passphrase 는 이 시맨틱을 secret 마다 복제 확장 (Q5).
- export: BIP39 12-word 자동 생성 + Argon2id(m=64MiB, t=3, p=4) envelope
  (ADR 0021). 터널 secret 도 같은 envelope, key 경로는 strip
  (DuckDB path strip 선례 `src-tauri/src/commands/connection/io.rs`).

**연결 라이프사이클 (터널이 얹힐 층)**
- #1100: per-connection `connection_guard` + `install_connection` 원자 대칭
  (`src-tauri/src/commands/connection.rs:229–276`) — 교체 시 구 keep-alive
  abort + 구 adapter disconnect. 터널 setup/teardown 을 같은 guard 아래
  얹으면 터널 누수(연결 끊김 후 SSH 세션 잔존)를 별도 로직 없이 차단 (Q2).

**에러 표면 (현행 갭)**
- `AppError` 에 SSH variant 없음 (`src-tauri/src/error.rs:34–127`).
- 힌팅 레이어 (#1056): `DRIVER_ERROR_CATEGORIES` 5종
  (`src/lib/errors/driverErrorHints.ts:18–24`), 매칭 실패 시 **fail-open
  null → 원문 그대로 노출** (`:119`). SSH 에러 원문이 이 fail-open 을 타면
  key 경로·fingerprint 가 UI 로 샌다 — Q6 + #1453 이 막을 지점.

**연결 폼 (프론트)**
- SSH 필드 0. 예고 주석만 존재: "Future SSH-key-path or SSH-host fields can
  extend this list" (`useConnectionDraftForm.ts:190` — 이슈 본문의 `:179` 는
  현재 코드 기준 `:190` 으로 드리프트).
- trim 경계 (`trimDraft`, `:192–198`): SSH host/key-path 는 trim 목록 확장,
  passphrase 는 password 와 동일하게 verbatim (ADR 0005 각주 준용).

**엔진별 connect 경로 (터널 배선 지점)**
- sqlx (pg/mysql/mariadb): host/port 기반 ConnectOptions
  (`src-tauri/src/db/mysql/connection.rs:94` 등) — 커스텀 stream 주입 불가.
- tiberius (mssql): stream 주입 가능한 유일 드라이버 (`tiberius 0.12.3`).
- mongodb / redis / reqwest(ES·OS) / oracle-rs: host/port·URL 기반.
- 결론: 균일 배선은 로컬 listener 뿐. in-process 직결은 mssql 만 용이 —
  이 편차가 §5 "로컬 포트 바인딩" 결정의 기술 배경.

**의존성 현황**
- `Cargo.toml`: SSH crate 0. tokio full + rustls 계열 정렬
  (sqlx runtime-tokio-rustls, redis tokio-rustls-comp, reqwest rustls-tls).
  russh 계열은 tokio 정합 (Q3 근거와 일치).

## 4. 사용자 실수 시나리오

- **TOFU blind accept**: fingerprint 대조 없이 확인 버튼 — TOFU 의 인적 한계.
  다이얼로그에 "서버에서 확인하는 법" (`ssh-keygen -lf`) 안내로 완화 가능.
- **key 파일 위치 실수**: iCloud/Dropbox sync 폴더나 repo 안의 key 를 지정.
  앱이 내용을 복제 저장하지 않으므로 (Q5) 앱발 유출 표면 추가 = 0. 파일
  자체의 위험은 사용자 소관으로 남는다.
- **passphrase 없는 key**: 파일 탈취 = 즉시 전권. 앱이 강제 불가 — 잔여 위험.
- **export envelope 공유** (Slack/메일): mnemonic 없인 복호 불가 (ADR 0021),
  key 경로는 strip — 봉투 재사용의 직접 이득.
- **key 파일 이동/삭제/개명**: 경로 참조 방식의 대가 — 연결 실패. Q6 SSH
  카테고리로 "key 파일을 찾을 수 없음" 명시 안내 (ADR 0052 트레이드오프).
- **동일 bastion 다연결**: 연결별 터널로 세션 폭증 → bastion 측
  MaxSessions/rate-limit 차단. 보안 아닌 가용성 문제 — 공유 bastion 후속 트리거.

## 5. 완화 — 옵션별 대응 (잠긴 축은 근거 요약, 미결 축은 옵션 비교)

### 5.1 인증 방식 (Q1 — locked)

| 방식 | 저장 문제 | 위협 | 판정 |
|---|---|---|---|
| password | 봉투 암호화 저장 +1 (기존 계약 그대로) | 저장 secret 증가. brute-force 는 서버 정책 소관 | 1차 채택 |
| key file(+passphrase) | 내용 미저장·경로 참조. passphrase 만 봉투 | 경로 평문 → 위치 정보 노출 (export strip 완화). 파일 유출은 앱 밖 | 1차 채택 |
| ssh-agent | 저장 0 (이상적) | forwarding hijack 실수 표면 + OS 별 소켓/lifetime 편차 (macOS launchd / `SSH_AUTH_SOCK` / Windows OpenSSH agent) | 후속 이월 |

### 5.2 터널 라이프사이클 (Q2 — locked)

- 연결별: #1100 원자 대칭 재사용 → 터널 누수 0. 비용 = bastion 당 N 세션.
  단 **1 SSH 세션이 pool 의 N 개 direct-tcpip 채널을 다중화**하므로 연결당
  세션은 1개 — 폭증은 "같은 bastion 을 쓰는 연결 수" 축에서만 발생.
- 공유: 세션 절약 대신 N:1 refcount teardown ("마지막 연결만 내림") 필요 —
  라이프사이클 불변식이 깨지기 쉬움. 실측 문제 시에만 (YAGNI).

### 5.3 Rust 라이브러리 (Q3 — 방향 locked, crate/버전 미결)

지식 기반 정리 (웹 조회 불가 — **구현 PR 에서 최신 advisory 재검증 필수**):

| 후보 | 성격 | 유지보수/감사 관점 |
|---|---|---|
| **russh** (warp-tech) | 순수 Rust, tokio, client+server | thrussh fork. 활발히 유지 (Warpgate 가 프로덕션 사용). Terrapin(CVE-2023-48795) strict-kex 대응 릴리스 존재 — 버전 하한 근거. 공식 3rd-party 감사 이력은 미확인 |
| ssh2 (libssh2 바인딩) | C FFI, blocking | 성숙하나 파서 attack surface 가 C 측 + 시스템 lib 빌드 의존 — Q3 기각 사유와 정면 충돌 |
| openssh (시스템 ssh subprocess) | 파서 자체 부담 0 | 사용자 머신 ssh 바이너리 의존 — Windows 가용성·버전 편차, 데스크탑 배포에 부적합 |
| makiko / thrussh | 순수 Rust | 커뮤니티·유지보수 규모 열세 / 사실상 후계(russh)로 대체 |

- cargo-deny 가 이미 gate 로 있으므로 RUSTSEC advisory 감시는 기존 절차에 편입.

### 5.4 Host key 검증 (Q4 — locked)

| 정책 | MITM 방어 | 비용 |
|---|---|---|
| 무검증 (blind-accept) | 0 — 터널 암호화 주장 무효 | 배제 (어떤 경로로도 금지) |
| 시스템 known_hosts 상속 | OpenSSH 생태계 그대로 | 포맷/CA/`@revoked` 파싱 복잡도 + 사용자 파일 mutate 책임 — 미채택 |
| **TOFU + 앱 SQLite 핀 + 불일치 hard-fail** | 최초 연결 이후 지속 방어 | 최초 연결 MITM 은 구조적 한계. 핀·판정 로직 자체 테스트 책임 |

### 5.5 로컬 포트 바인딩 (ADR 0052 미결 — 신규 분석)

| 옵션 | 노출면 | 비용 |
|---|---|---|
| `127.0.0.1:0` ephemeral listener (연결당) | listen 중 로컬 타 프로세스가 접속 → bastion 도달권 편승. TCP 라 peer 인증 수단 없음 | 전 엔진 균일 배선. 완화: 연결 active 동안만 listen, pool max 로 accept 상한, disconnect 시 즉시 close |
| in-process stream 직결 (listener 0) | 노출 0 | tiberius 만 용이. sqlx/mongodb/redis/reqwest 는 커스텀 stream 미지원 — 엔진별 분기 폭발 |

- 로컬 악성 프로세스는 어차피 keyring 접근 가능 (ADR 0040 threat 2 와 동일
  수용선)이므로 단일 사용자 데스크탑에선 리스크 증가분이 제한적. **다중 사용자
  머신**에서만 실질 신규 표면 — 완화 수위를 grill 로 결정.
- 파생 결정 — **TLS-over-tunnel**: 드라이버가 `127.0.0.1` 로 접속하면 DB TLS
  hostname 검증이 원 host 와 불일치. (a) 조합 차단, (b) 경고 + trust 요구,
  (c) 드라이버별 hostname override (지원 편차 큼) 중 정책 필요.

## 6. 잔여 위험 (오너가 수용해야 할 트레이드오프)

1. **TOFU 최초 연결 MITM** — 구조적 한계. out-of-band fingerprint 대조 안내로
   완화하되 강제 불가 (1차 범위 밖).
2. **로컬 listener 채택 시 로컬 프로세스 편승** — 단일 사용자 머신에선 ADR
   0040 threat 2 와 동일 수용선, 다중 사용자 머신은 신규 표면.
3. **russh 자체 host key 로직 책임** — OpenSSH 성숙 생태계를 상속하지 않음.
   핀/판정/알고리즘 선택의 테스트 책임 + 공식 감사 이력 부재.
4. **key 경로 평문 저장** — 파일 위치 정보 노출 (export strip 으로 완화).
5. **passphrase 없는 key 사용자** — 앱이 막을 수 없는 사용자 소관 위험.
6. **연결별 터널의 bastion 세션 수** — 보안 아닌 리소스/가용성. 공유 bastion
   후속 트리거로 관리.

## 7. Grill 결정 질문 (오픈 축만 — 잠긴 Q1~Q6 재개봉은 supersede 절차)

1. 터널→드라이버 배선: 전 엔진 균일 `127.0.0.1` ephemeral listener 인가, mssql 만 stream 직결 예외를 두는가?
2. listener 완화 수위: 연결 active 동안만 listen + pool max accept 상한이면 충분한가, 다중 사용자 머신 경고 UI 까지 넣는가?
3. TLS-over-tunnel 정책: 조합 차단 / 경고+trust 요구 / hostname override 중 무엇인가?
4. russh crate/버전 확정: 버전 하한 = Terrapin strict-kex 대응 릴리스 이상 + cargo-deny advisory clean 을 채택 기준으로 잠그는가?
5. 지원 key 포맷 범위: OpenSSH(신형)+PEM, Ed25519/ECDSA/RSA 로 한정하고 PuTTY PPK 는 명시 제외하는가?
6. fingerprint 표기: OpenSSH 동형 SHA-256 base64 단일 표기로 확정하는가?
7. host key 불일치 hard-fail 후 재핀 UX: 명시적 "핀 삭제 후 재확인" 액션의 위치와 마찰 수위는?
8. known_hosts 핀의 export envelope 포함 여부: 편의(새 머신 TOFU 생략) vs 신뢰 이식 위험 중 무엇을 택하는가?
9. 터널 mid-session drop 시 상태 전이: 기존 keep-alive/재연결 경로에 태우는가, SSH 전용 재시도 없이 hard-fail 인가?
10. SSH connect 타임아웃: 기존 connection timeout clamp (mssql 선례) 를 재사용하는가?
11. 다단 hop (ProxyJump chain) 1차 명시 제외를 known-limitations 에 기록하는가?
