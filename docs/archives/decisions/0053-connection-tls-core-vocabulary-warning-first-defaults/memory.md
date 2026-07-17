---
id: 0053
title: connection TLS core vocabulary + warning-first defaults
status: Accepted
date: 2026-07-17
supersedes: null
superseded_by: null
---

**결정**: 연결 폼 TLS 노출 parity (#1063, 2026-07-17 오너 grill) 의 1차 어휘와 기본값 자세를 확정한다. Threat-model handoff (`docs/explorations/connection-tls-parity-threat-model-2026-07-17.md`) 의 옵션 비교 위에서 4개 결정을 잠근다. **(1 — 공통 어휘, §5a 옵션 C)** core 2필드 (`tlsEnabled` + `trustServerCertificate`) 를 전 엔진 통일하고, 추가로 **pg/mysql 은 sslmode enum (`disable`/`prefer`/`require`/`verify-full`) 을 이번 범위에 포함**한다. `verify-ca` 는 CA 파일과 결합해야 의미가 있으므로 1차에서 제외하고, CA 파일·클라이언트 인증서·1단 엔진 enum 확장·TOFU 인증서 핀 검토 등 advanced depth 는 후속(#1649)으로 분리한다 (breadth-first: 어휘를 넓게 통일하고 depth 는 버전 단위 승격). 공통 결정 경로는 기존 `src-tauri/src/db/tls.rs` `resolve_tls_decision()` 를 재사용한다. **(2 — mssql 신규 기본, §5d-2)** mssql 신규 연결 기본값 `trust=true`(require+skip-verify) 를 **유지**하되 **폼 경고 문구**로 잔여 위험(MITM 인증서 치환 미방어)을 명시한다. verify 기본으로의 전환은 자가서명 mssql 서버 사용자에게 즉시 연결 실패를 일으키므로 채택하지 않고, 위험을 차단이 아니라 경고로 노출한다(로컬 도구 자율성). **(3 — pg/mysql 미설정 자세, §5d-1)** pg/mysql 의 TLS 미설정 = driver `Prefer`(기회적 암호화) 기본을 **유지**하고 **폼 힌트**를 노출한다(mysql 에도 pg 의 `tlsHintPg` 와 동일 적용). 신규 연결 verify-full 전면 강제는 기존 연결 파손 위험이라 미채택. mysql/mariadb 폼 TLS 컨트롤 노출(백엔드는 #1062 로 이미 결선, UI 만 부재)은 이번 parity 범위에 **포함**한다. **(4 — URL 붙여넣기, §5d-3)** URL 파싱에서 `sslmode`/`tls`/`ssl-mode` 파라미터를 **존중**하고, 현행 core 어휘로 매핑 불가한 값은 **"반영되지 않음" 고지**로 조용한 유실을 막는다. **파생 규칙**: 1단 엔진(mongo/redis/valkey/es/os)에 trust(skip-verify)를 노출하되 명시 opt-in + 폼 경고를 붙인다; oracle 은 #904 hard-reject 로 parity 범위에서 제외(TLS 는 #1065 소관)함을 명문화한다; 1단 엔진 저장값 `tls=true, trust=None` 은 verify-full 고정 매핑으로 재해석한다(현행 실동작과 동일, 다운그레이드 0); dbType 전환 carry/reset 매트릭스를 새 TLS 필드마다 확장한다(`TLS_TOGGLE_DATABASE_TYPES` 패턴).

**이유**:

1. **왜 ADR 이 필요한가 — mssql skip-verify 기본 유지는 맥락 없이 보면 의아하다** — "TLS 켜짐 + 인증서 검증 끔" 을 신규 연결의 기본값으로 두는 것은 보안 문서만 읽으면 명백한 안티패턴이다. 그러나 (a) tiberius mssql 은 encryption off 시 `NotSupported` 라 암호화는 강제되고, (b) mssql 생태계의 압도적 다수가 자가서명 인증서로 배포되어 verify 기본은 즉시 연결 실패로 나타나며, (c) 로컬 DB 도구는 사용자의 위험 선택을 차단하지 않고 경고까지만 한다는 원칙(ADR 0036/0040 신뢰 모델과 동형)이 맞물린 결과다. 이 세 맥락 없이는 후임자가 "왜 안전한 기본으로 안 바꿨지" 하며 되돌리기 쉬우므로, 결정·근거·잔여 위험 수용을 동결한다.
2. **어휘 통일이 곧 멘탈 모델 회복 (결정 1)** — 현행은 0단(mysql/oracle)·1단(mongo/redis/search)·2단(mssql/pg) 어휘가 혼재해(threat-model §0 표) 사용자가 "TLS 켰다=안전" 을 엔진마다 다르게 오해한다. core 2필드를 전 엔진에 통일하면 어휘 비대칭이 사라진다. pg/mysql 에 sslmode enum 을 더 얹는 것은 이 두 드라이버가 이미 `Prefer`/`Require`/`VerifyFull` 을 네이티브로 구분하고, pg 사용자 어휘(`?sslmode=`)와 일치하며, 후속 CA(verify-ca)와 자연 결합하기 때문이다. 옵션 B(전 엔진 sslmode superset)는 tiberius·mongo·redis 매핑 비대칭으로 구현·테스트 비용이 최대라 미채택, 옵션 C(core+후속 advanced)를 택했다.
3. **파손 없는 경로만 기본값으로 (결정 2·3)** — 기본값 강화(Prefer→verify-full, trust=true→false)는 self-signed·구형 서버 사용자에게 즉시 연결 실패다. 파손 없는 유일한 경로는 "신규만 강화 + 기존은 편집 시 안내" 뿐이고 그 기간의 다운그레이드 자세는 잔존한다(§6). 이 트레이드오프를 감안해 기본값은 현행 유지 + 경고/힌트로 위험을 가시화하는 방향을 택했다. mysql UI 노출은 백엔드가 이미 결선돼(#1062) UI 만 열면 되므로 이번 범위에 포함된다.
4. **조용한 유실이 가장 나쁜 실패 (결정 4)** — URL 붙여넣기에서 `?sslmode=verify-full` 이 조용히 폐기되면(현행 `model.ts` 는 mssql `encrypt`/`trustServerCertificate` 와 `rediss:` 만 존중) 사용자는 원본 URL 의 보안 자세가 유지된다고 오인한다. 파라미터를 존중하고 매핑 불가 값을 명시 고지하는 것은 "보안 관련 침묵 금지" 원칙의 최소 구현이다.

**트레이드오프**:

- **+** 어휘 단일화로 사용자 멘탈 모델 회복, self-signed TLS-off 행동 유도(§4-3) 완화. 기존 `tls.rs` 결정 경로 재사용으로 신규 정책 면적 최소.
- **+** 기본값 현행 유지로 기존 연결 파손 0 — 위험은 차단이 아니라 경고/힌트로 가시화.
- **+** pg/mysql sslmode enum 을 지금 여는 것이 후속 CA(verify-ca) 결합의 토대가 된다.
- **−** **mssql 신규 기본 trust=true 는 MITM 인증서 치환 미방어** — "암호화됨" 표시가 검증 없는 자세를 가릴 수 있다. 경고 문구로만 완화하고 잔여 위험을 수용한다. 이는 소유자가 명시 수용한 트레이드오프다.
- **−** **skip-verify 옵션이 전 엔진(1단 포함)에 노출** = MITM 허용 자세의 표면 확대. 명시 opt-in + 경고로만 완화하며, 차단은 불가(로컬 도구 자율성).
- **−** **boolean+sslmode 두 어휘의 공존 기간** — core 2필드와 pg/mysql enum 이 섞여 있어, advanced(#1649) 도입 시 1단 엔진 boolean→enum 마이그레이션이 필요하다.
- **−** **verify-full 도 OS trust store 신뢰가 전제** — 머신에 심긴 악성 root CA 는 어떤 옵션도 못 막는다(ADR 0040 Threat 2 동형).
- **재개 트리거**: 본 ADR 은 어휘·기본값 결정만 동결한다. 구현(전 엔진 폼 필드, sslmode enum UI, 경고/힌트 문구, URL 파서 확장, carry/reset 매트릭스, 1단 엔진 저장값 재해석)은 #1063 트래커 소관. advanced depth(CA·클라이언트 인증서·1단 sslmode 확장·TOFU 핀)는 #1649 로 분리. mssql 기본값을 verify 로 뒤집으려면 새 ADR + Supersede.

**관련**:

- issue #1063 — 연결 폼 TLS 노출 parity 구현 트래커. 본 ADR 이 1차 어휘·기본값을 확정하고 needs-decision 해소.
- issue #1649 — advanced TLS depth-step (CA 파일·클라이언트 인증서·1단 엔진 sslmode 확장·TOFU 인증서 핀 검토). 결정 1 의 후속 depth.
- `docs/explorations/connection-tls-parity-threat-model-2026-07-17.md` — 본 결정의 threat-model 근거(§5a 어휘, §5d 기본값·다운그레이드, §5c 후속 인증서 위협면, §6 잔여 위험).
- ADR 0052 — SSH 터널 TOFU host key 핀. self-signed 서버 신뢰의 기존 선례 어휘(TOFU 인증서 핀 검토의 참조축).
- ADR 0040 — File-key OS keyring. verify-full 도 못 막는 running-malware 신뢰 모델(Threat 2)의 동형 수용선.
- ADR 0036 — Telemetry 0. TLS 설정/인증서 경로가 외부로 나가는 유일한 경로 = 사용자 자발적 export.
- ADR 0005 — plaintext 비밀번호는 IPC 경계를 넘지 않는다. (후속) 클라이언트 키 passphrase 가 상속할 계약.
- `src-tauri/src/db/tls.rs` — `resolve_tls_decision()` 공통 결정 경로. pg/mysql sslmode enum 확장 지점.
- `src/features/connection/components/forms/` — 엔진별 폼 필드. core 2필드 통일 + 경고/힌트 확장 지점.
