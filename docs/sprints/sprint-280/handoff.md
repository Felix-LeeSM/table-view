# Sprint 280 — Phase 17 dev env fix

**날짜**: 2026-05-13
**범위**: Sprint 277~279 MySQL 합류 직후 surfacing 된 3건 환경 이슈 일괄 처리.

## 변경

### 1. `src-tauri/deny.toml` — RUSTSEC-2023-0071 ignore 등록

- 경로: `sqlx-mysql 0.8.6 → rsa 0.9.10` (transitive).
- advisory: rsa 0.9 Marvin Attack (RSA timing sidechannel).
- 실 영향: advisory 자체가 "local use on a non-compromised computer is
  fine" 명시. Marvin Attack 은 attacker 가 victim 의 RSA 연산 timing
  을 네트워크상에서 측정 가능한 시나리오 (예: TLS server) 전제.
  Table View 는 desktop app — 사용자가 자신의 MySQL server 에 직접 접속
  하며 attacker 가 user connection 의 timing 을 측정할 채널이 없다.
- 해소 조건: sqlx 0.9+ 또는 rsa 0.10+ 채택.
- RISKS.md 동기화 필요 (active 항목 등록 — 2026-05-13).

### 2. `package.json db:up` — mysql 추가

```diff
-"db:up": "docker compose up -d postgres mongo && ./scripts/db/wait.sh",
+"db:up": "docker compose up -d postgres mongo mysql && ./scripts/db/wait.sh",
```

- Sprint 277 에서 `docker-compose.yml mysql` 서비스 + `scripts/db/wait.sh`
  의 mysql healthcheck 분기는 이미 합류했으나 `db:up` script 가 mysql 을
  `up -d` 대상에서 빠뜨려 wait.sh 가 `SKIP: table_view_mysql not running`
  로 즉시 통과하던 dead path 가 있었음.
- 검증: `pnpm db:up` → `mysql ready.` 정상 출력.

### 3. `scripts/fixtures/index.ts cmdConnections` — 빈 인자 usage hint

- 회귀: `pnpm db:connections` 만 입력 시 cryptic `unknown connections
  action ''` throw. pnpm 은 `--` 없이 인자 전달이 어색해 사용자가 자주
  맞닥뜨리는 표면이라 친절한 usage 분기 추가.
- exit code 2 (usage error) — 0 (성공) 과 1 (runtime error) 구분.

## 검증

```bash
cargo deny --manifest-path src-tauri/Cargo.toml check advisories  # advisories ok
pnpm tsc --noEmit                                                 # pass
pnpm lint                                                         # pass
pnpm db:up                                                        # mysql ready.
pnpm db:connections                                               # usage hint (exit 2)
```

## 후속

- Sprint 281+ (originally Sprint 280) — MysqlAdapter RdbAdapter trait
  impl 본체 (`list_namespaces` / `list_tables` / `get_columns` /
  `fetch_rows`) + `make_adapter` factory MySQL arm 활성화.
- RISKS.md 에 RUSTSEC-2023-0071 active 항목 추가 (별도 commit 권장 —
  사용자 검토).
