---
title: "SSH 터널 지원 (#1064): Threat-Model Handoff"
type: threat-model-handoff
issue: "#1064"
updated: 2026-07-17
status: decisions locked 2026-07-17
related:
  - issue #1064 (SSH 터널 tracker)
  - issue #1453 (연결 에러 마스킹 갭)
  - issue #1056 (드라이버 에러 힌팅 레이어)
  - docs/decisions/0052-ssh-tunnel-connection-scoped-tofu/memory.md
  - docs/decisions/0040-file-key-os-keyring/memory.md
  - docs/decisions/0005-plaintext-password-never-leaves-backend/memory.md
  - docs/decisions/0021-export-envelope-auto-mnemonic-no-ttl/memory.md
  - docs/decisions/0036-telemetry-zero-collection/memory.md
---

# SSH 터널 지원 (#1064): Threat-Model Handoff (2026-07-17)

## 0. 선행 결정 상태: 반드시 먼저 읽을 것

**ADR 0052 (Accepted 2026-07-10) 가 이미 존재한다.** 이슈 #1064 가 적어 둔
「착수 전 grill 권장」 항목 가운데 다음 여섯 축은 2026-07-10 오너 grill 에서 이미
확정되었다.

| 축 | 확정된 결정 |
|---|---|
| Q1 인증 범위 | 1차 = password + key file(+passphrase). ssh-agent 후속 이월 |
| Q2 라이프사이클 | 연결별 터널 (#1100 원자 대칭 위). 공유 bastion refcount 후속 |
| Q3 라이브러리 | russh 계열 순수 Rust. **정확한 crate·버전은 구현 시 확정 (미결)** |
| Q4 host key | TOFU + 앱 관리 known_hosts(SQLite 영속) + 불일치 hard-fail. blind-accept 배제 |
| Q5 secret 저장 | 기존 keyring/master-key 봉투 재사용 (ADR 0040/0005). key 파일 내용 미저장·경로 참조, export 시 strip |
| Q6 에러 표면 | `AppError::SshTunnel` 분리 + redact + hint SSH 카테고리 (#1453 병행) |

따라서 이 handoff 는 두 가지 역할을 맡는다.

1. 확정된 여섯 축의 위협 근거를 informed consent 수준으로 정리해서 사후에
   보강한다.
2. **ADR 0052 가 미결로 남긴 잔여 축**, 그러니까 로컬 포트 바인딩 노출면과
   crate·버전 확정, fingerprint 표기, 재핀 UX, TLS-over-tunnel 등에 대해 grill
   입력을 제공한다.

이미 확정된 축을 다시 논의하려면 ADR 본문 동결 규칙에 따라 **새 ADR 을 쓰고
Supersede 하는** 절차를 밟아야 한다. 확정된 축을 일반 options grill 로 다시 묻는
것은 인덱스 규칙을 어기는 일이다.

## 1. 자산 (보호 대상)

- **SSH 자격증명 (신규 secret)**: 터널 접속에 쓰는 password 와 key passphrase 가
  여기에 해당한다.
- **SSH private key 파일**: 앱 바깥에 있는 자산이다. 앱은 파일 내용을 저장하지
  않고 경로만 참조한다 (Q5). 경로 문자열 자체도 사용자의 홈 디렉터리 구조와 키가
  놓인 위치를 드러내므로 정보 자산에 해당한다.
- **bastion 을 경유하는 내부망 도달권**: 터널이 열리는 순간 로컬 머신에 방화벽
  뒤의 DB 포트로 이어지는 경로가 생긴다. 이전에는 없던 자산 유형이다.
- **host key 신뢰 앵커**: 앱이 관리하는 known_hosts 핀이다. 이 핀이 오염되면
  그 뒤로는 MITM 을 정상 연결로 통과시킨다.
- **DB 자격증명과 쿼리, 데이터**: 터널을 통과하는 트래픽이므로 이전부터 있던
  자산이다.

## 2. 위협

**외부 공격**
- MITM: host key 를 검증하지 않으면 SSH 로 암호화한다는 주장 자체가 무효가
  된다. TOFU 는 최초 연결 시점의 MITM 을 구조적으로 막지 못하며, ADR 0052 가
  이를 트레이드오프로 명시한다.
- SSH wire 파서: 신뢰할 수 없는 원격 입력을 해석하는 코드다. C 바인딩을 쓰면
  FFI 경계와 메모리 안전성 위험이 함께 따라오므로, Q3 에서 순수 Rust 를 택해
  이 경로를 배제했다.
- 프로토콜 다운그레이드: Terrapin (CVE-2023-48795) 같은 공격이 여기 해당하므로,
  strict-kex 에 대응하는 릴리스를 버전 하한으로 잡아야 한다.

**로컬 공격과 노출면**
- 로컬 포트 리스너 (미결 축): 터널을 `127.0.0.1:<ephemeral>` listener 로
  드라이버에 연결하면, listen 하는 동안 **같은 머신의 다른 프로세스나 사용자**가
  그 포트에 접속해 사용자의 SSH 세션을 거쳐 내부망 DB 포트까지 도달할 수 있다.
  DB 인증은 여전히 필요하지만, 방화벽 뒤 네트워크에 닿을 수 있다는 사실 자체가
  외부로 노출된다.
- 에러와 로그 에코: russh 가 만드는 에러 문자열에 key 경로와 fingerprint,
  사용자명이 섞여서 사이드바나 로그로 유출될 수 있다. 현행 `connection_redacted`
  는 URI userinfo 와 `password=`/`pwd=` 만 마스킹하므로
  (`src-tauri/table-view-core/src/error.rs:136`), SSH 흔적은 지금의 redaction
  범위 밖에 있다. Q6 가 이 문제를 해소할 대상이다.

**내부 실수**
- TOFU dialog fatigue: 사용자가 fingerprint 를 확인하지 않고 습관적으로 accept
  를 누르는 상황이다.
- TLS-over-tunnel 오설정: 터널을 경유하면 드라이버가 `127.0.0.1` 로 접속하므로
  DB TLS 의 hostname 검증이 원래 host 와 충돌한다. 그래서 사용자가 검증을 꺼서
  우회하도록 유도하는 실수가 생긴다.

**Supply-chain**
- 새로운 SSH crate 를 의존성으로 추가해야 한다. 현재 `src-tauri/Cargo.toml` 에는
  SSH 의존성이 하나도 없다. Cargo.toml 주석에 명시된 cargo-deny gate 로 RUSTSEC
  advisory 를 계속 감시해야 한다.

**사이드채널**
- IPC 경계: SSH secret 이 프론트로 직렬화되면 ADR 0005 를 위반한다.
- 스크린샷과 화면공유: fingerprint 는 비밀이 아니므로 표시해도 안전하고,
  password 필드는 기존의 마스킹 관례를 따른다.
- Telemetry: 해당하지 않는다. ADR 0036 이 수집을 0 으로 두므로 SSH host 와
  fingerprint 도 외부로 전혀 송신되지 않는다.

## 3. 현재 인프라 정밀 분석

**암호화와 저장 (기존 구성을 재사용하고 새 매체는 도입하지 않는다)**
- at-rest 는 AES-256-GCM 으로 암호화하고, master file-key 는 OS keyring 에 둔다
  (`com.tableview.app.file-key`, `src-tauri/table-view-core/src/storage/crypto.rs:22`).
  Linux 에서 Secret Service 를 쓸 수 없으면 0600 권한의 disk fallback 으로
  내려가고 probe 를 50ms 간격으로 3회 재시도한다 (`crypto.rs:84–114`). 이 구성은
  ADR 0040 의 threat 1 (offline disk-access) 을 방어하고 threat 2 (running
  malware) 는 범위 밖에 두는데, SSH secret 에도 같은 수용선을 적용한다.
- IPC 경계에서 plaintext 는 백엔드 밖으로 나가지 않는다 (ADR 0005).
  `list_connections` 는 password 필드 자체를 포함하지 않으며,
  `src-tauri/src/commands/connection/crud.rs:388–408` 의 회귀 테스트가 이를
  지킨다.
- secret 편집은 세 가지 상태를 갖는다. `Some(s)` 는 교체이고, `None` 은 유지이며,
  `Some("")` 은 삭제다. 백엔드에서는 `save_connection` 이
  (`crud.rs:415–490` 테스트), 프론트에서는 `resolvePassword` 가
  (`src/features/connection/components/ConnectionDialog/useConnectionDraftForm.ts:174–183`)
  이 시맨틱을 구현한다. 터널 password 와 passphrase 도 같은 시맨틱을 secret 마다
  복제해서 확장한다 (Q5).
- export 는 BIP39 12-word 를 자동 생성하고 Argon2id(m=64MiB, t=3, p=4) envelope
  으로 감싼다 (ADR 0021). 터널 secret 도 같은 envelope 을 쓰고 key 경로는
  strip 하는데, DuckDB path strip 이 그 선례에 해당한다
  (`src-tauri/src/commands/connection/io.rs`).

**연결 라이프사이클 (터널을 적용할 계층)**
- #1100 이 per-connection `connection_guard` 와 `install_connection` 의 원자
  대칭을 도입했다 (`src-tauri/src/commands/connection.rs:229–276`). 연결을
  교체할 때 이전 keep-alive 를 abort 하고 이전 adapter 를 disconnect 한다.
  터널의 setup 과 teardown 을 같은 guard 아래에 두면 연결이 끊긴 뒤에도 SSH
  세션이 남는 터널 누수를 별도 로직 없이 차단할 수 있다 (Q2).

**에러 표면 (현행 갭)**
- `AppError` 에는 SSH variant 가 없다
  (`src-tauri/table-view-core/src/error.rs:34–127`).
- 힌팅 레이어 (#1056) 는 `DRIVER_ERROR_CATEGORIES` 5종을 갖고 있는데
  (`src/lib/errors/driverErrorHints.ts:18–24`), 어느 것에도 매칭되지 않으면
  **fail-open 으로 null 을 돌려주어 원문을 그대로 노출한다** (`:119`). SSH 에러
  원문이 이 fail-open 경로를 거치면 key 경로와 fingerprint 가 UI 로 유출되므로,
  Q6 와 #1453 이 이 지점을 막아야 한다.

**연결 폼 (프론트)**
- SSH 필드는 하나도 없고 예고 주석만 있다. "Future SSH-key-path or SSH-host
  fields can extend this list" 가 `useConnectionDraftForm.ts:190` 에 있는데,
  이슈 본문이 적은 `:179` 는 현재 코드 기준으로 `:190` 까지 밀렸다.
- trim 경계는 `trimDraft` 가 담당한다 (`:192–198`). SSH host 와 key-path 는
  trim 목록에 추가하고, passphrase 는 password 와 마찬가지로 verbatim 으로
  두어서 ADR 0005 의 각주를 그대로 따른다.

**엔진별 connect 경로 (터널을 연결할 지점)**
- sqlx (pg/mysql/mariadb) 는 host 와 port 를 받는 ConnectOptions 를 쓰므로
  (`src-tauri/table-view-core/src/db/mysql/connection.rs:94` 등) 커스텀 stream
  을 주입할 수 없다.
- tiberius (mssql) 는 stream 을 주입할 수 있는 유일한 드라이버다
  (`tiberius 0.12.3`).
- mongodb 와 redis, reqwest(ES·OS), oracle-rs 는 host/port 또는 URL 을 받는다.
- 따라서 전 엔진에 균일하게 적용할 수 있는 방식은 로컬 listener 뿐이고,
  in-process 직결은 mssql 에서만 수월하다. 이 편차가 §5 의 「로컬 포트 바인딩」
  결정을 만든 기술적 배경이다.

**의존성 현황**
- `Cargo.toml` 에는 SSH crate 가 없다. tokio full 과 rustls 계열이 정렬되어
  있으며 (sqlx runtime-tokio-rustls, redis tokio-rustls-comp, reqwest
  rustls-tls), russh 계열은 이 tokio 구성과 맞으므로 Q3 의 근거와도 일치한다.

## 4. 사용자 실수 시나리오

- **TOFU blind accept**: 사용자가 fingerprint 를 대조하지 않고 확인 버튼을
  누르는 상황이며, TOFU 가 안고 있는 인적 한계에 해당한다. 다이얼로그에 서버에서
  값을 확인하는 방법 (`ssh-keygen -lf`) 을 안내하면 완화할 수 있다.
- **key 파일 위치 실수**: iCloud 나 Dropbox 의 sync 폴더, 또는 repo 안에 있는
  key 를 지정하는 경우다. 앱이 파일 내용을 복제해서 저장하지 않으므로 (Q5) 앱
  때문에 늘어나는 유출 표면은 없다. 파일 자체가 안고 있는 위험은 사용자 소관으로
  남는다.
- **passphrase 없는 key**: 파일을 탈취당하면 그 즉시 전권을 넘겨주게 된다. 앱이
  passphrase 설정을 강제할 수 없으므로 잔여 위험으로 남는다.
- **export envelope 공유** (Slack 이나 메일): mnemonic 이 없으면 복호할 수 없고
  (ADR 0021) key 경로는 strip 되므로, 기존 봉투를 재사용해서 얻는 직접적인
  이득이다.
- **key 파일 이동·삭제·개명**: 경로를 참조하는 방식이라 치러야 하는 대가이며,
  결과는 연결 실패다. Q6 의 SSH 카테고리로 "key 파일을 찾을 수 없음" 을 명시해서
  안내한다 (ADR 0052 트레이드오프).
- **같은 bastion 에 연결이 여럿인 경우**: 연결마다 터널을 열면 세션이 급격히
  늘어나 bastion 쪽 MaxSessions 나 rate-limit 에 걸려 차단된다. 보안 문제가
  아니라 가용성 문제이며, 공유 bastion 을 후속으로 검토하게 만드는 트리거다.

## 5. 완화: 옵션별 대응 (확정된 축은 근거를 요약하고, 미결 축은 옵션을 비교한다)

### 5.1 인증 방식 (Q1: 확정됨)

| 방식 | 저장 문제 | 위협 | 판정 |
|---|---|---|---|
| password | 봉투 암호화 저장 +1 (기존 계약 그대로) | 저장 secret 증가. brute-force 는 서버 정책 소관 | 1차 채택 |
| key file(+passphrase) | 내용 미저장·경로 참조. passphrase 만 봉투 | 경로 평문 → 위치 정보 노출 (export strip 완화). 파일 유출은 앱 밖 | 1차 채택 |
| ssh-agent | 저장 0 (이상적) | forwarding hijack 실수 표면 + OS 별 소켓/lifetime 편차 (macOS launchd / `SSH_AUTH_SOCK` / Windows OpenSSH agent) | 후속 이월 |

### 5.2 터널 라이프사이클 (Q2: 확정됨)

- 연결별로 터널을 열면 #1100 의 원자 대칭을 재사용해서 터널 누수를 0 으로
  만들 수 있고, 대신 bastion 마다 N 개의 세션을 치른다. 다만 **SSH 세션 하나가
  pool 의 direct-tcpip 채널 N 개를 다중화**하므로 연결당 세션은 하나이고, 세션이
  급격히 늘어나는 것은 같은 bastion 을 쓰는 연결 수가 많아질 때뿐이다.
- 터널을 공유하면 세션을 절약하는 대신 마지막 연결만 내리는 N:1 refcount
  teardown 이 필요한데, 라이프사이클 불변식이 깨지기 쉽다. 실제로 문제가
  측정될 때만 도입한다 (YAGNI).

### 5.3 Rust 라이브러리 (Q3: 방향은 확정됐고 crate 와 버전은 미결)

웹을 조회할 수 없어 지식 기반으로 정리한 내용이므로, **구현 PR 에서 최신
advisory 를 반드시 다시 검증해야 한다.**

| 후보 | 성격 | 유지보수·감사 관점 |
|---|---|---|
| **russh** (warp-tech) | 순수 Rust, tokio, client+server | thrussh fork. 활발히 유지 (Warpgate 가 프로덕션 사용). Terrapin(CVE-2023-48795) strict-kex 대응 릴리스가 있어서 버전 하한의 근거가 된다. 공식 3rd-party 감사 이력은 미확인 |
| ssh2 (libssh2 바인딩) | C FFI, blocking | 성숙하지만 파서 attack surface 가 C 쪽에 있고 시스템 lib 빌드에 의존하므로, Q3 의 기각 사유와 정면으로 충돌한다 |
| openssh (시스템 ssh subprocess) | 파서 자체 부담 0 | 사용자 머신의 ssh 바이너리에 의존하므로 Windows 가용성과 버전 편차 문제가 있고, 데스크탑 배포에 부적합하다 |
| makiko / thrussh | 순수 Rust | 커뮤니티·유지보수 규모 열세 / 사실상 후계(russh)로 대체 |

- cargo-deny 가 이미 gate 로 들어와 있으므로 RUSTSEC advisory 감시는 기존 절차에
  편입한다.

### 5.4 Host key 검증 (Q4: 확정됨)

| 정책 | MITM 방어 | 비용 |
|---|---|---|
| 무검증 (blind-accept) | 0. 터널을 암호화한다는 주장 자체가 무효가 된다 | 배제 (어떤 경로로도 금지) |
| 시스템 known_hosts 상속 | OpenSSH 생태계 그대로 | 포맷·CA·`@revoked` 파싱이 복잡하고 사용자 파일을 변경할 책임까지 지므로 미채택 |
| **TOFU + 앱 SQLite 핀 + 불일치 hard-fail** | 최초 연결 이후 지속 방어 | 최초 연결 MITM 은 구조적 한계. 핀·판정 로직 자체 테스트 책임 |

### 5.5 로컬 포트 바인딩 (ADR 0052 가 미결로 남긴 축이라 새로 분석한다)

| 옵션 | 노출면 | 비용 |
|---|---|---|
| `127.0.0.1:0` ephemeral listener (연결당) | listen 하는 동안 로컬의 다른 프로세스가 접속해서 bastion 도달권에 편승한다. TCP 라 peer 를 인증할 수단이 없다 | 전 엔진 균일 배선. 완화: 연결 active 동안만 listen, pool max 로 accept 상한, disconnect 시 즉시 close |
| in-process stream 직결 (listener 0) | 노출 0 | tiberius 에서만 수월하다. sqlx·mongodb·redis·reqwest 는 커스텀 stream 을 지원하지 않으므로 엔진별 분기가 급격히 늘어난다 |

- 로컬 악성 프로세스는 어차피 keyring 에 접근할 수 있어서 (ADR 0040 threat 2 와
  같은 수용선이다) 단일 사용자 데스크탑에서는 위험 증가분이 제한적이다. 실질적인
  신규 표면은 **다중 사용자 머신**에서만 생기므로, 완화를 어느 수위로 할지는
  grill 에서 결정한다.
- 여기서 파생하는 결정이 **TLS-over-tunnel** 이다. 드라이버가 `127.0.0.1` 로
  접속하면 DB TLS 의 hostname 검증이 원래 host 와 불일치하므로, (a) 조합 차단,
  (b) 경고 후 trust 요구, (c) 드라이버별 hostname override (지원 편차가 크다)
  가운데 하나로 정책을 정해야 한다.

## 6. 잔여 위험 (오너가 수용해야 할 트레이드오프)

1. **TOFU 의 최초 연결 MITM** 은 구조적 한계다. out-of-band 로 fingerprint 를
   대조하도록 안내해서 완화할 수는 있지만 강제하지는 못하며, 강제는 1차 범위
   밖이다.
2. **로컬 listener 를 채택하면 로컬 프로세스가 편승할 수 있다.** 단일 사용자
   머신에서는 ADR 0040 의 threat 2 와 같은 수용선이고, 다중 사용자 머신에서는
   새로 생기는 표면이다.
3. **russh 의 host key 로직을 직접 책임져야 한다.** OpenSSH 의 성숙한 생태계를
   상속하지 않으므로, 핀과 판정, 알고리즘 선택을 테스트할 책임이 생기고 공식
   감사 이력도 없다.
4. **key 경로를 평문으로 저장하므로** 파일 위치 정보가 노출되며, export 시
   strip 으로 완화한다.
5. **passphrase 를 걸지 않은 사용자의 key** 는 앱이 막을 수 없고 사용자 소관으로
   남는 위험이다.
6. **연결별 터널이 만드는 bastion 세션 수**는 보안이 아니라 리소스와 가용성
   문제이며, 공유 bastion 을 후속으로 검토하는 트리거로 관리한다.

## 7. Grill 결정 질문 (열린 축만 다루며, 확정된 Q1~Q6 를 다시 열려면 supersede 절차를 밟는다)

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

## 결정 (2026-07-17 grill)

**ADR 0052 (Accepted 2026-07-10) 의 여섯 축 (Q1~Q6) 은 이미 확정되었으므로 다시
기록할 필요가 없다.** 아래는 §0 이 미결로 남긴 **잔여 축**만 확정한다. #1064 의
결정은 ADR 대상이 아니고 방향은 ADR 0052 가 이미 동결했으므로, 이 threat-model
기록만으로 충분하다. 본문 §1~6 의 분석은 고치지 않고 그대로 둔다.

1. **터널과 DB TLS 를 함께 쓰는 조합 (§5.5 에서 파생)**: 드라이버가 `127.0.0.1`
   로 접속하더라도 **원래 호스트명을 기준으로 인증서를 검증한다 (hostname
   override)**. 드라이버가 hostname override 를 지원하지 않는 엔진에서는
   **경고를 띄우고 trust 로 fallback 한다** (질문 3). 조합을 차단하거나 무조건
   override 하는 대신 지원 편차를 경고로 노출하는 쪽을 택했다.
2. **host key 핀은 1차에서 export envelope 에 포함하지 않는다.** 신뢰가 그대로
   옮겨 가는 위험을 피하고, 새 머신에서는 TOFU 로 다시 확인한다 (질문 8).

**파생 결정** (열린 축의 나머지):

- 터널을 드라이버에 연결하는 방식은 **전 엔진에 균일한 `127.0.0.1` ephemeral
  listener** 로 한다. mssql 만 stream 직결로 빼는 예외는 두지 않는데, 엔진별
  분기가 급격히 늘어나는 것을 피하기 위해서다 (질문 1).
- listener 완화는 **연결이 active 한 동안만 listen 하고 pool max 로 accept
  상한을 두는** 방식으로 하며, disconnect 하면 즉시 close 한다 (질문 2).
- russh 의 crate 와 버전은 **Terrapin (CVE-2023-48795) strict-kex 대응 릴리스
  이상이면서 cargo-deny advisory 가 clean 한 것**을 채택 기준으로 확정한다
  (질문 4).
- key 포맷은 **OpenSSH (신형) 와 PEM, 그리고 Ed25519/ECDSA/RSA** 로 한정하고,
  **PuTTY PPK 는 명시적으로 제외한다** (질문 5).
- fingerprint 는 **OpenSSH 와 동형인 SHA-256 base64 단일 표기**로 나타낸다
  (질문 6).
- host key 가 불일치하면 hard-fail 한 뒤에 **핀을 삭제하고 다시 확인하는 명시적인
  액션**을 제공한다 (질문 7).
- mid-session drop 은 **기존 keep-alive 와 재연결 경로를 재사용**하고 SSH 전용
  재시도는 새로 만들지 않는다 (질문 9).
- SSH connect 타임아웃은 **mssql 선례가 있는 기존 connection timeout clamp 를
  재사용한다** (질문 10).
- 다단 hop (ProxyJump chain) 은 **1차에서 명시적으로 제외하고
  known-limitations 에 기록한다** (질문 11).
