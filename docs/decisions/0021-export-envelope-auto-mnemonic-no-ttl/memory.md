---
id: 0021
title: Export envelope은 자동 생성 BIP39 mnemonic을 쓰며 TTL/max_uses는 도입하지 않는다
status: Accepted
date: 2026-05-05
---

**결정**: `export_connections_encrypted` 명령은 사용자에게 master password를 묻지 않는다. 백엔드가 호출마다 BIP39 12-word mnemonic(~128-bit entropy)을 자동 생성해 envelope과 함께 단일 응답으로 돌려주고, 프론트는 mnemonic을 단 한 번 표시한 뒤 사용자가 "저장했다" 체크박스를 명시 인정해야 envelope JSON을 노출한다. envelope에 TTL/`expires_at`/`max_uses` 같은 만료 필드는 추가하지 않는다. Argon2id 파라미터는 OWASP "first profile"(m=64MiB, t=3, p=4)로 상향한다.

**이유**:
- **자동 생성**: 사용자 입력 password는 약한 password가 envelope 강도의 floor가 된다(MIN_LEN 8자는 brute-force 저항 부족). BIP39 12-word는 외울 수 있으면서 entropy 충분 — 강도와 분실 리스크의 균형. KDF 강도 상향은 floor가 충분히 높을 때만 의미 있다.
- **TTL 미도입**: 클라이언트 단독으로 만료를 enforce 할 수 없다. envelope을 풀 권한(=mnemonic)을 가진 사람은 (a) 시스템 시계 되돌림, (b) 만료 전 평문 추출 보관, (c) wrapper 코드 우회로 모두 우회 가능. "정직성 정책 가드"는 약속 0이면서 UX 복잡도와 코드 부채만 남긴다. 진짜 만료가 필요한 시나리오는 외부 신뢰 앵커(서버 매개 key 발급, 또는 DB 자체의 short-lived IAM 자격증명)에 위임한다.
- **Argon2id 상향**: 자동 생성으로 password 자체가 강해졌으므로 KDF 강화의 한계 효용이 살아난다. m=19MiB→64MiB, t=2→3, p=1→4. 사용자 1회 derive 비용은 ~1초로 무해하지만 GPU/ASIC brute-force 비용은 30~50배. 옛 envelope은 KDF 파라미터를 envelope에 함께 저장하므로 backward decrypt 가능 — 마이그 0.

**트레이드오프**:
- **+ 약한 password 위험 0** / **- mnemonic 분실 시 영구 복구 불가**(체크박스 + 1회 표시 + 비밀번호 매니저 안내로 완화)
- **+ 코드/UX 단순**(strength meter, password 검증 룰, password generator 옵션 분기 모두 불필요) / **- 사용자가 password 자체를 못 정함**(편의성 일부 상실 — 백업·이동 시나리오는 어차피 password 매니저 보관이 정석이라 큰 문제 아님)
- **+ over-promise 회피**(만료 약속 안 함 → 사용자 신뢰 보호) / **- 외부 만료 정책이 필요한 사용자는 별도 가이드 필요**(short-lived DB 자격증명 워크플로 권장)

**구현 포인트** (회귀 시 ADR 위반):
- `src-tauri/src/storage/crypto.rs` — `generate_export_password()`, `derive_envelope_key()` 반환 `Zeroizing<[u8; 32]>`, Argon2id `(m=65_536, t=3, p=4)`.
- `src-tauri/src/commands/connection.rs` — `export_connections_encrypted(ids: Vec<String>) -> EncryptedExportResult { password, json }`. master_password 인자 / MIN_LEN 검증 부활은 회귀.
- `src/components/connection/ImportExportDialog.tsx` — Export 단계에서 사용자 password 입력 필드 부활 또는 acknowledgement 체크박스 제거는 회귀.
- envelope JSON에 `expires_at` / `max_uses` 필드 추가는 회귀.
