# Sprint 169 — Sprint 2~5 Combined Contracts

> 단일 generator pass에서 Sprint 1 위에 누적 구현. 각 sprint의 Done Criteria
> 모두 충족해야 다음으로 진행. 모든 ACs는 `command` 또는 static 검증 가능.

---

## Sprint 2 — Compose stack: services healthy + e2e wired

### In Scope
- `docker-compose.yml`: postgres + mongo healthchecks (이미 존재; 검증), `e2e` 서비스 wiring 보강.
- `e2e` 서비스에 `command` 또는 `entrypoint`가 명시되어 컨테이너 시작 시 `e2e/run-e2e-docker.sh`를 실행하도록 한다(Dockerfile.e2e의 `CMD ["bash"]`를 override).
- `e2e` 서비스 `working_dir: /app` 명시(이미지의 WORKDIR과 동일하나 명시적으로).
- `e2e` 서비스에 `volumes:`로 `e2e/wdio-report` bind mount 추가(Sprint 4와 충돌 없음 — Sprint 4는 캐시 볼륨 추가).
- `.env.example`: 새 mongo/e2e 변수 문서화. 기존 `MYSQL_TCP_PORT`/`ES_PORT`/`REDIS_PORT`는 unused지만 다른 작업과 충돌 막기 위해 유지(out-of-scope로 판단).

### Out of Scope
- `target` cache volume(Sprint 4).
- CI workflow 변경(Sprint 5).
- mysql/es/redis 서비스 재도입.

### Done Criteria
1. `docker compose --profile test config -q` 0 exit, no warnings.
2. `docker compose --profile test config | grep -E 'profiles|service_healthy'` 출력에서 `e2e` 가 두 DB에 `condition: service_healthy`로 의존함 확인.
3. `docker compose ps`(no profile)는 `e2e` 서비스 미시작.
4. `e2e` 서비스에 `command`/`entrypoint`가 `e2e/run-e2e-docker.sh` 또는 `bash /app/e2e/run-e2e-docker.sh`로 명시.
5. `e2e` 서비스 환경 변수에 `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`E2E_MONGO_HOST`/`E2E_PG_HOST`/`MONGO_USER`/`MONGO_PASSWORD` 모두 정의.
6. `.env.example`에 `MONGO_USER`, `MONGO_PASSWORD` 문서화 추가.

---

## Sprint 3 — End-to-end pipeline runs green

### In Scope
- `e2e/run-e2e-docker.sh`: 시드 멱등화(`ON CONFLICT DO NOTHING`), Tauri 빌드 단계 추가(이미지에서 빠졌으므로), exit code 정확히 전파.
- `pnpm tauri build --debug --no-bundle` 단계가 실행되도록 한다(Sprint 4가 캐시 도입 시 동일 명령 재사용).
- 시드 SQL의 단일 source of truth 도입을 위한 별도 파일 `e2e/fixtures/seed.sql` 신설(Sprint 5 dedup 사전 작업; run-e2e-docker.sh가 이 파일을 `psql -f`로 호출).
- Mongo seed가 필요하다면 추가하되, 현재 `connection-switch.spec.ts`는 connection 생성만 검증하므로 별도 mongo seed 불필요.

### Out of Scope
- `target/` 캐시 볼륨 도입(Sprint 4).
- wdio-report bind mount 자체는 Sprint 2가 추가, 이번엔 보존만 확인.
- CI 통합(Sprint 5).

### Done Criteria
1. `e2e/run-e2e-docker.sh`는 `set -euo pipefail`, 시드 후 Tauri 빌드, 마지막에 `exec xvfb-run pnpm test:e2e`.
2. 시드 SQL은 `e2e/fixtures/seed.sql`에 정의되며 `INSERT` 문에 `ON CONFLICT (email) DO NOTHING` 등 멱등 절을 포함.
3. `e2e/run-e2e-docker.sh`는 `psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -f /app/e2e/fixtures/seed.sql` 형태로 단일 파일을 호출.
4. WebdriverIO exit code 가 컨테이너 exit code 와 동일(`exec` 사용으로 보장).
5. `e2e/fixtures/seed.sql`은 `git ls-files` 로 추적 대상이 되어야 함.

---

## Sprint 4 — Build cache + report extraction

### In Scope
- `docker-compose.yml`: `e2e` 서비스에 named volume `tauri-target` 을 `/app/src-tauri/target` 에 마운트, `pnpm-store` named volume을 `/app/.pnpm-store` 또는 `~/.local/share/pnpm/store` 에 마운트(선택).
- `e2e/wdio-report` bind mount(Sprint 2에서 추가된 mount 유지).
- `.dockerignore`/`.gitignore`: `e2e/wdio-report/` 가 build context에서 제외되어 있고 git에서도 제외되는지 재확인.
- `Dockerfile.e2e`는 변경 최소(이미 sprint 1에서 source COPY가 마지막 layer).

### Out of Scope
- BuildKit cache mount(`RUN --mount=type=cache`) — named volume 방식이 docker compose에서 더 단순하므로 우선 채택. 추후 sprint에서 BuildKit으로 전환 가능.
- 다중 stage build.

### Done Criteria
1. `docker-compose.yml` 의 `e2e` 서비스에 `tauri-target` 또는 동등한 named volume이 `/app/src-tauri/target` 에 매핑됨.
2. `e2e/wdio-report` 가 host 측 `./e2e/wdio-report` 디렉토리에 bind mount 됨.
3. `volumes:` 섹션에 `tauri-target:` named volume 정의 추가.
4. `e2e/wdio-report/.gitkeep` 신설(디렉토리가 host에 존재해야 bind mount가 자연스러움; 비어있을 때도 git에 반영). `.gitignore`는 `wdio-report/`만 제외하므로 `e2e/wdio-report/.gitkeep`은 추적 가능. 필요 시 `.gitignore`를 `wdio-report/*` 로 변경하여 `.gitkeep` 추적.

---

## Sprint 5 — CI 통합 + seed dedup + ADR + 문서

### In Scope
- `.github/workflows/ci.yml` 의 `e2e` job을 docker pipeline 위임 형태로 슬림화:
  - `services:` 블록 제거(또는 유지하되 inline psql/apt 단계 제거. 결정: 풀 위임 — `services:` 제거하고 `pnpm test:e2e:docker` 만 호출).
  - `apt install`/`cargo install tauri-driver`/`pnpm install`/`xvfb-run pnpm test:e2e` 모두 제거.
  - 새 step: docker compose build + `--profile test up --abort-on-container-exit --exit-code-from e2e`.
  - 실패 시 `e2e/wdio-report/` artifact upload 유지 (`path: e2e/wdio-report/`).
- `scripts/setup-e2e.sh`: `docker-compose.test.yml` 참조 제거, `pnpm test:e2e:docker` 를 canonical Linux/CI 경로로 안내, macOS 한계 문서화.
- 새 ADR `memory/decisions/0015-e2e-docker-pipeline-canonical/memory.md`: docker pipeline을 E2E 표준으로 채택한 결정, macOS 미지원, Tauri build를 runtime + named volume cache로 둔 이유, 이전 inline-CI 접근 대비 trade-offs.
- 시드 SQL grep 통일성: `grep -rn "CREATE TABLE IF NOT EXISTS users"` 가 정확히 1건(`e2e/fixtures/seed.sql`).
- README/docs는 변경 최소(필요 시 한 줄). `CLAUDE.md`/팔레스는 건드리지 않음(원칙).

### Out of Scope
- `integration-tests` CI job 변경(별개 cargo test 작업, 본 작업 범위 밖).
- `wait-for-test-db.sh` 제거.
- `docker-compose.test.yml` 부활.

### Done Criteria
1. `.github/workflows/ci.yml`의 `e2e` job에 inline `psql`, inline `apt-get install webkit2gtk-driver`, `cargo install tauri-driver` 모두 부재. `pnpm test:e2e:docker` 또는 동등 docker compose 호출 1단계만 존재.
2. 실패 시 artifact upload 유지(`if: failure()` step).
3. `grep -rn "CREATE TABLE IF NOT EXISTS users" .github/ e2e/ scripts/ src-tauri/ 2>/dev/null` 결과 1건만(`e2e/fixtures/seed.sql`).
4. ADR 0015 신설; status `Accepted`, date `2026-04-29`. front-matter 정확.
5. `scripts/setup-e2e.sh` 갱신; `docker-compose.test.yml` 문자열 부재; `pnpm test:e2e:docker` 명시; macOS 한계 한 줄 명시.

---

## Verification Strategy (전 sprint 공통)

- macOS arm64 호스트에서 `docker compose config -q`, `docker compose --profile test config` 등 정적 검증 + `docker compose build e2e` 까지는 검증 가능.
- 실제 e2e 실행은 cold start linux/amd64 emulation으로 매우 느려 CI(remote runner)에 위임.
- generator는 commit/push 직전까지 모든 정적 검증, grep, ADR 작성 완료.
