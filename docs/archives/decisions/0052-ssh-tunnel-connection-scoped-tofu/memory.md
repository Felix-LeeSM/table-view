---
id: 0052
title: SSH 터널 지원 — 연결별 터널 + TOFU host key 핀 + keyring 봉투 재사용
status: Accepted
date: 2026-07-10
supersedes: null
superseded_by: null
---

**결정**: 원격 network-DBMS 연결에 SSH 터널을 도입한다 (#1064, 2026-07-10 오너 grill). 6 축을 확정한다. **(Q1 인증 범위)** 1차 지원은 password + key file(+passphrase) 두 방식. ssh-agent 는 후속으로 이월 — agent forwarding 은 실수 표면이 넓고 OS 별 편차(macOS launchd agent / Linux `SSH_AUTH_SOCK` / Windows OpenSSH agent)가 커 1차에서 배제한다. **(Q2 라이프사이클)** 연결별 터널 — 각 DB 연결이 독립 SSH 세션을 소유한다. 기존 #1100 의 `install_connection`/`disconnect` 원자 대칭(`src-tauri/src/commands/connection.rs:236` install / `:230` disconnect) 위에 터널 setup/teardown 을 얹어, adapter 와 터널이 한 lifecycle lock 아래 함께 서고 함께 내려간다. 공유 bastion 재사용(같은 SSH 호스트를 N 연결이 공유)은 후속 성능 최적화로 이월. **(Q3 라이브러리)** russh 계열 순수 Rust SSH 구현 — C 바인딩(libssh2)의 파서 attack surface 를 피하고, 공급망 의존을 최소화하며, tokio async 런타임과 정합한다. 정확한 crate·버전은 구현 시 확정. **(Q4 host key 검증)** TOFU + 영속화 — 첫 연결 시 서버 host key fingerprint 를 UI 로 사용자에게 확인받아 앱 관리 known_hosts(SQLite 영속)에 핀한다. 이후 fingerprint 불일치는 hard-fail(무경보 자동 수락 금지). blind-accept(검증 없는 무조건 수락) 는 어떤 경로로도 배제한다. **(Q5 secret 저장)** 기존 keyring/master_key 봉투(ADR 0040) 를 재사용한다 — 터널 password 와 key passphrase 는 DB password 와 **동일 계약**으로 암호화 저장(`src-tauri/src/storage/crypto.rs`), IPC 경계에서 마스킹(ADR 0005). key 파일 **내용은 저장하지 않고 경로 참조만** 보관하며, 경로는 host 처럼 평문 저장하되 export 시 strip 한다(DuckDB path strip 선례 `src-tauri/src/commands/connection/io.rs`). `save_connection` 의 `Option<String>` 3-state(`Some`=교체 / `None`=유지 / empty=삭제, `src-tauri/src/commands/connection/crud.rs`) 시맨틱을 새 secret(터널 password·passphrase) 마다 확장 적용한다. **(Q6 에러 표면)** SSH 계층을 DB 에러에서 분리한다 — 신규 `AppError::SshTunnel`(또는 phase 마커, `src-tauri/src/error.rs:34`) variant 를 추가하고, 사이드바 도달 전에 key 경로·fingerprint·auth 흔적을 redact 하며, `src/lib/errors/driverErrorHints.ts` 의 `DRIVER_ERROR_CATEGORIES` 에 SSH 카테고리를 추가해 fail-open 원문 노출을 막는다. Q6 는 #1453(연결 에러 마스킹 갭)과 **동일 코드 표면**이라 병행 처리한다.

**이유**:

1. **채택 차단급 결손 해소 — breadth-first 확장** — SSH 터널은 TablePlus / DBeaver 등 경쟁 도구의 기본 기능이고, 방화벽·bastion 뒤 원격 DB 에 접속하려는 사용자에게는 기능이 없으면 도구 선택 자체가 막힌다. 현재 코드베이스에 SSH 관련 코드는 0 건이며 `useConnectionDraftForm.ts` 의 예고 주석("Future SSH-key-path or SSH-host fields can extend this list", 트림 boundary comment) 한 줄뿐이다. 제품 방향(breadth-first: 기능 넓게, 깊이는 버전 단위 승격)에 따라 1차는 password+key file 로 넓게 열고 agent/공유 bastion 은 후속으로 깊이를 더한다.
2. **Q1 — 표면 최소화가 곧 보안** — password 와 key file 은 사용자가 직접 제어하는 자격증명이라 신뢰 경계가 명확하다. ssh-agent forwarding 은 원격 호스트가 로컬 agent 를 통해 다른 서버로 인증하도록 위임하는 실수(agent hijacking)를 노출하고, OS 별 소켓/lifetime 편차로 실패 모드가 커진다 — 1차 범위에서 제외해 attack surface 와 지원 부담을 함께 줄인다.
3. **Q2 — 원자 대칭 재사용** — #1100 이 이미 "adapter 설치와 해제가 한 lifecycle lock 아래 원자적"이라는 불변식을 세웠다. 연결별 터널을 이 대칭에 얹으면 터널 누수(연결은 끊겼는데 SSH 세션이 살아있음)를 별도 로직 없이 막는다. 공유 bastion 은 lifecycle 이 N:1 로 갈라져 "마지막 연결이 끊길 때만 터널 teardown" 이라는 refcount 를 요구하므로, 성능이 실측으로 문제될 때만 도입한다(YAGNI).
4. **Q3 — 파서 attack surface + 공급망** — SSH wire 프로토콜 파싱은 신뢰 불가한 원격 입력을 다루는 코드다. 순수 Rust(russh) 는 memory-safety 를 언어 수준에서 보장하고 C 바인딩의 FFI 경계·빌드 의존(libssh2/OpenSSL 시스템 lib)을 없앤다. tokio 정합으로 기존 async adapter 런타임과 한 reactor 위에 선다.
5. **Q4 — 완전 신규 신뢰 앵커** — host key 검증은 이 앱에 처음 생기는 신뢰 앵커다. 검증을 게을리하면(blind-accept) SSH 계층이 그대로 MITM 통로가 되어, 암호화 터널이라는 주장 자체가 무효가 된다. TOFU(첫 연결에 사용자 확인 후 핀)는 로컬 desktop 도구에서 CA 없이 실용적인 표준 모델(OpenSSH `known_hosts` 와 동형)이고, 이후 불일치 hard-fail 은 "같은 위험 = 같은 게이트" 일관성 원칙에 부합한다. 앱 관리 known_hosts 를 SQLite 에 영속해 재확인 마찰 없이 지속 검증한다.
6. **Q5 — 기존 봉투 계약 그대로** — 새 secret 저장 매체를 만들지 않는다. 터널 password·passphrase 는 DB password 와 완전히 같은 경로(keyring master-key 봉투 암호화 + IPC 마스킹 + export envelope)를 타므로 검증된 threat model(ADR 0040 offline disk-access, ADR 0005 IPC 경계)을 그대로 상속한다. key 파일 **내용 미저장**은 원칙적 선택 — 파일 내용을 복제 저장하면 두 번째 유출 지점이 생기고 파일 권한(0600) 관리 책임이 앱으로 넘어온다. 경로만 참조하고 export 시 strip 하는 것은 DuckDB 파일 경로 strip 선례와 동형이라 새 정책이 아니다.
7. **Q6 — #1453 과 동일 표면** — SSH 에러(auth 실패, host key 불일치, key 경로 오류)를 DB 드라이버 에러와 뭉뚱그리면 (a) 사용자가 "DB 문제"로 오진하고 (b) 원문에 key 경로·fingerprint 가 섞여 사이드바로 새어 나간다. AppError 를 분리하고 hint 카테고리를 추가하며 도달 전 redact 하는 것은 #1453 의 연결 에러 마스킹 갭과 정확히 같은 코드 지점(`error.rs` + `driverErrorHints.ts`)을 건드리므로 병행이 중복 없이 두 요구를 함께 만족한다. **기각 대안 — SSH 에러를 기존 `Connection(String)` 에 흡수**: variant 추가가 없어 구현은 짧지만, UI 가 SSH 실패와 DB 실패를 구분할 근거를 잃고 redact 대상(경로·fingerprint)이 일반 연결 에러 문자열에 섞여 fail-open 노출 위험이 남으므로 기각.

**트레이드오프**:

- **+** 원격 DB 접속의 채택 차단급 결손 해소 — 경쟁 도구 parity 확보, breadth-first 확장의 큰 한 축.
- **+** 새 저장 매체·새 신뢰 모델을 만들지 않음 — secret 은 ADR 0040/0005 봉투 재사용, 라이프사이클은 #1100 원자 대칭 재사용, 에러 표면은 #1453 과 공유. 신규 정책 면적 최소.
- **+** 순수 Rust 구현으로 파서 attack surface·FFI 경계·시스템 lib 빌드 의존 제거.
- **−** **TOFU 최초 연결 MITM 한계** — 첫 연결 시점에 이미 중간자가 앉아 있으면 사용자가 위조 fingerprint 를 진짜로 confirm 할 수 있다. TOFU 의 구조적 한계이며, 완전 방어는 out-of-band fingerprint 검증(사용자가 서버 측 fingerprint 를 별도 채널로 확인)에 의존한다 — 1차 범위 밖. 이후 연결의 불일치 hard-fail 은 여전히 유효.
- **−** **key file 경로 참조** — 파일 내용을 저장하지 않으므로 사용자가 key 파일을 이동·삭제·이름 변경하면 연결이 실패한다. 내용 복제 저장(두 번째 유출 지점) 대신 감수하는 트레이드오프 — 실패 시 에러는 Q6 의 SSH 카테고리로 "key 파일을 찾을 수 없음"을 명확히 안내.
- **−** **russh host key 로직 자체 구현 책임** — OpenSSH `known_hosts` 파일 포맷·CA·`@revoked` 마커 등 성숙한 생태계를 그대로 물려받지 않고, 핀·불일치 판정을 앱이 직접 구현한다. host key 알고리즘 선택·fingerprint 표현·불일치 판정 로직에 자체 테스트 책임이 따른다.
- **−** **연결별 터널의 N 세션 비용** — 같은 bastion 을 여러 연결이 쓰면 SSH 세션이 연결 수만큼 열린다. 재사용 refcount 가 없어 리소스·핸드셰이크 비용이 중복 — 실측으로 문제 될 때 공유 bastion(Q2 후속)으로 최적화.
- **재개 트리거**: 본 ADR 은 결정만 동결한다. 구현(SSH 필드 UI, russh 터널 setup/teardown, host key 확인 다이얼로그·SQLite known_hosts, AppError·hint 카테고리, secret 3-state 확장)은 미착수 — Tracker: issue #1064. 1차 구현 스테이징 = password + key file 우선, agent·공유 bastion 은 후속.

**관련**:

- issue #1064 — SSH 터널 지원 구현 tracker. 본 ADR 이 방향을 확정하고 needs-decision 해소, 잔여는 구현.
- issue #1453 — 연결 에러 마스킹 갭. Q6 와 동일 코드 표면(`error.rs` + `driverErrorHints.ts`)이라 병행 처리 권장.
- issue #1056 — 드라이버 에러 힌팅 레이어. SSH 카테고리를 이 레이어에 추가한다.
- ADR 0040 — File-key OS keyring 봉투. 터널 password·passphrase 가 재사용하는 master-key 저장 계약.
- ADR 0005 — plaintext 비밀번호는 IPC 경계를 넘지 않는다. 터널 secret 도 동일 마스킹 불변식.
- ADR 0021 — Export envelope. 터널 secret 도 같은 envelope 로 export/import, key 파일 경로는 strip.
- `src-tauri/src/storage/crypto.rs` — master-key 봉투 암복호. 터널 secret 암호화 확장 지점.
- `src-tauri/src/models/connection.rs` — `ConnectionConfig`(`Option<String>` 필드군). SSH host/port/user/auth/key-path 필드 확장 지점.
- `src-tauri/src/commands/connection/crud.rs` — `save_connection` 의 `Option<String>` 3-state + `test_connection` 3-way password resolution. secret 마다 확장.
- `src-tauri/src/commands/connection.rs:236` — #1100 `install_connection`/`disconnect` 원자 대칭. 터널 setup/teardown 을 얹는 층.
- `src-tauri/src/commands/connection/io.rs` — DuckDB 파일 경로 export strip 선례. key 파일 경로 strip 이 따를 패턴.
- `src-tauri/src/error.rs:34` — `AppError` enum. 신규 `SshTunnel` variant 추가 지점.
- `src/lib/errors/driverErrorHints.ts` — `DRIVER_ERROR_CATEGORIES`. SSH 카테고리 추가 지점.
- `src/features/connection/components/ConnectionDialog/useConnectionDraftForm.ts` — SSH 필드 예고 주석(트림 boundary). SSH host/key-path 필드가 확장할 폼 hook.
