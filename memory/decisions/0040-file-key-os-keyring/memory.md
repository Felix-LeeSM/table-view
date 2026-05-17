---
id: 0040
title: File-key OS keyring + 2-phase migration with Linux fallback
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: Password ciphertext 의 master file-key 저장 위치를 OS 키체인
(macOS Keychain / Windows Credential Manager / Linux Secret Service)
으로 이주한다. 디스크 `.key` 평문 폐기. Threat 1 (offline disk-access)
보호.

1. **저장 매체** — Rust `keyring` crate. Entry name
   `com.tableview.app.file-key`.
2. **Linux fallback** — Secret Service 미가용 환경 (서버 / minimal
   desktop) 에서 file mode 유지 (perm 0o600). 사용자에게 1회 toast
   "디스크 암호화 권장". Backend path 분기 1곳.
3. **2-phase migration with rollback (codex 2차 #4 fix)** — 기존 사용자
   boot 시 1회 `get_or_create_key()` 가 다음 절차:
   - (1) keyring read 시도.
   - (2) 없으면 디스크 `.key` 존재 확인.
   - (3) 디스크에 있으면 keyring 으로 import → 디스크 파일 perm 0o000
     변경 → secure delete (zeroize + unlink).
   - (4) keyring write 실패 시 디스크 파일 그대로 두고 dev log + Linux
     fallback path 로 분기.
4. **재암호화 금지** — Password ciphertext (`connections.password_enc`
   BLOB) 는 SQLite migration 시 byte-copy. File-key 만 keyring 으로
   이주. Plaintext 가 메모리에 노출되는 윈도우 0.
5. **신규 사용자 — keyring 만** — 첫 boot 에 `get_or_create_key()` 가
   keyring write 1회. 디스크 `.key` 안 만듦. AC 검증.

**이유**:

1. **Threat model — Threat 1 offline disk-access 보호** — 노트북 도난
   / 디스크 image dump 시 OS 로그인 password 없으면 keyring 의 file-key
   복호화 불가. 기존 `.key` 평문 파일은 디스크만 있으면 즉시 풀림 (모든
   password ciphertext 의 master 가 노출). OS keyring 이 이 위험 차단.
2. **Threat 2 running malware 는 보호 못 함** — 사용자 머신에서 실행 중인
   malware 는 OS 로그인된 process 라 keyring access 가능 (OS-level 권한).
   이건 어떤 옵션이든 동일 — 본 ADR 의 범위가 아니다.
3. **2-phase migration rollback safety** — `crypto.rs` 의 기존
   `get_or_create_key()` 는 `.key` 없으면 **새 key 생성** 의 안티패턴.
   만약 keyring 이주 실패 후 `.key` 도 지워졌으면 기존 ciphertext 의
   master 가 lost = 모든 connection password orphan. 2-phase 절차 (read
   → import → delete) + Linux fallback 분기로 어떤 경로든 ciphertext
   복호화 보존.
4. **재암호화 금지 의 보안 이득** — Password ciphertext 자체는 byte-copy
   로 SQLite BLOB 으로 이주. 만약 재암호화하면 (1) plaintext 가 메모리
   에 잠깐 존재 (window of vulnerability), (2) crash 시 partial 상태 위험.
   File-key 만 매체 이주 = ciphertext invariant 보존.
5. **Linux Secret Service fallback** — 서버 / Docker container / minimal
   desktop (i3wm, sway 등) 에서 Secret Service 미실행 가능. 기존 file
   mode 유지 + 사용자 안내 toast 가 그 환경에서 사용 가능성 보존. ADR
   0036 telemetry zero 에 따라 어떤 머신 정보도 외부 전송 0.

**트레이드오프**:

- **+** Threat 1 (offline disk-access) 의 실질적 보호 추가 — `.key`
  평문이 디스크에서 사라지면 image dump 만으로 file-key 복호화 불가.
- **+** macOS / Windows 사용자 (절대 다수) 의 보안 자동 향상.
- **+** Migration 2-phase 가 rollback safe — ciphertext orphan 위험 0.
- **+** 재암호화 안 함 = plaintext 메모리 노출 윈도우 0.
- **−** Linux Secret Service 미가용 환경의 fallback 분기 — 코드 복잡도
  +1 path. 단 1회성 toast + 기존 file mode 유지로 사용자 friction 최소.
- **−** Keyring crate 의 OS-specific API 의존 — 향후 OS API 변경 시
  업데이트 필요 (macOS Keychain access prompt 정책 변경 등).
- **−** Migration 실행 중 keyring write 실패 시 분기 — 첫 boot 에 키체인
  unlock prompt 거절하면 fallback path 로 떨어짐. 일관성을 위해 다음
  boot 에 재시도 (best-effort).
- **−** 사용자가 OS 계정 reset 시 keyring 도 reset = file-key 영구 lost.
  Password 자체는 `connections.password_enc` ciphertext 안에만 있어
  decrypt 불가 → connection password 재입력. ADR 0021 export envelope
  과 다른 layer (envelope 은 mnemonic 으로 복호화).
- **−** Test 환경 (CI) 에서 keyring 가용성 — Linux CI 에서 Secret
  Service 미실행 가정. Test 는 Linux fallback path 검증 + macOS/Windows
  은 native API 사용 통합 테스트.

**관련**:

- state-management-strategy-2026-05-15.md §Q22 line 433 (OS keyring + 3-path migration
  + Linux fallback)
- state-management-strategy-2026-05-15.md §Phase 1 AC line 1620–1622 (Q22 검증 — 신규
  / 기존 / Linux fallback 3 케이스)
- state-management-strategy-2026-05-15.md §F.1 line 867–909 (file-key keyring 이주는
  SQLite migration 과 별 1회 boot-time step)
- ADR 0005 — Plaintext password never leaves backend (본 ADR 의 file-key
  도 backend memory 만 — IPC 경계 안 넘김)
- ADR 0021 — Export envelope (별 layer — envelope 은 사용자 mnemonic 으로,
  본 ADR 은 OS keyring 으로 file-key 보관)
- ADR 0032 — SQLite infrastructure (ciphertext byte-copy migration)
- ADR 0035 — Corrupt recovery (SQLite corrupt 시에도 keyring 의 file-key
  보존 — 새 SQLite 에서 같은 file-key 로 decrypt 가능)
