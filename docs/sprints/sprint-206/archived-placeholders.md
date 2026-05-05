# Sprint 206 — Archived placeholder e2e

Sprint 206 가 e2e suite 에서 제거한 placeholder 시나리오 outline 보존.
후속 sprint 가 본문 작성 시 본 문서를 입력값으로 P1 (피라미드) 재검증
+ step 라벨 작성에 활용.

원본 출처: `e2e/feedback-2026-04-27.spec.ts` (5 describe), `e2e/db-switcher.spec.ts`
(파일 전체), `e2e/raw-query-db-change.spec.ts` (파일 전체) — Sprint 206
삭제.

## 1. feedback-2026-04-27.spec.ts (5 describe)

### #1 Home picker viewport

원본:
```text
Sprint 170 — RISK-025 가 sprint 155 에 resolved. tauri.conf.json 에
launcher 720x560 fixed / workspace 1280x800 resizable 로 분리됨.
본문 작성은 sprint-172 에서 `app.spec.ts` 에 흡수 (REVIVE).
```

권위: 없음 (e2e 만이 viewport size delta 검증 가능).

후속 진입 트리거: `app.spec.ts` 에 흡수 (Sprint 172 가 deferred 됨 —
필요 시 새 sprint 진입).

step outline:
1. ensureHomeScreen() — launcher window 활성
2. browser.execute(() => window.innerWidth/innerHeight) → 720/560 근사
3. switch to workspace window (open Test PG)
4. window.innerWidth/innerHeight → 1280/800 또는 그 이상

### #2 Switching connection from Home propagates to Workspace

원본 outline:
```text
1. openTestPgWorkspace() — workspace shows "Test PG"
2. backToHome()
3. create / pick a second connection ("Test PG Alt")
4. dispatch dblclick on the alt row
5. wait for Workspace re-mount
6. assert sidebar header / topbar reflects "Test PG Alt", not "Test PG"
```

권위: `HomePage.test.tsx` AC-S134-04 (component-level). e2e 변형은 멀티
윈도우 IPC sync 회귀 가드 목적.

후속 진입 트리거: HomePage.test.tsx 가 회귀 잡지 못하는 IPC 회귀 발생
시 별도 sprint.

### #5 Export/Import — encrypted round-trip (3 it)

원본 outline (#5a — round-trip):
```text
1. ensureTestPgConnection (with password "testpass")
2. open Import/Export → enter master pw → Generate encrypted JSON
3. capture envelope text
4. delete original connection
5. switch to Import tab → paste envelope → enter same master pw
6. import succeeds; new connection has has_password=true
7. double-click → workspace connects without re-prompting password
```

원본 outline (#5b — single-selection):
```text
1. ensureTestPgConnection + create a second connection
2. open Import/Export → uncheck all → check only one
3. Generate encrypted JSON
4. assert envelope ciphertext length scales with 1 connection
   (reasonable upper bound — exact length depends on Argon2id output)
```

원본 outline (#5c — group export):
```text
1. seed: 2 connections in group "G1", 1 connection ungrouped
2. open Import/Export → tick group G1 header → 2 children auto check,
   ungrouped stays unchecked
3. Generate encrypted JSON → counter reads "2 connections, 1 group selected"
```

권위: `ImportExportDialog.ac149.test.tsx` AC-149-5 (plaintext NOT
offered) + `e2e/import-export.spec.ts` (Argon2id+AES-GCM envelope shape
smoke). round-trip 본문 자체는 component / store 단계로 분해 가능.

후속 진입 트리거: encrypted round-trip 회귀 보고 시.

### #10 PG sidebar table count

원본 outline:
```text
1. openTestPgWorkspace()
2. seed table_view_test with N rows via raw query (or rely on a known
   fixture row count)
3. refresh sidebar
4. read [aria-label$="row count"] for that table → matches N

Alternative if the number is intentionally not row count:
- assert its title/aria-label clearly names what it represents
```

권위: 없음 (sidebar 표시 의미를 사용자 관점에서 검증).

후속 진입 트리거: row count UI 변경 / 사용자 보고 시.

### #12 MongoDB DB switch persistence

원본 outline:
```text
1. open mongo workspace
2. click DB switcher trigger
3. select "admin"
4. close popover
5. re-open switcher → trigger label says "admin", not the original default DB
```

권위: 없음. env-conditional (`E2E_MONGO_HOST`).

후속 진입 트리거: Mongo DB switch 회귀 발생 시.

## 2. db-switcher.spec.ts (파일 전체)

원본 머리주석:
```text
Sprint 133 — DB switcher (PG sub-pool LRU + Mongo in-connection switch)
smoke test scaffolding.

The full-body coverage targets the workspace toolbar's DB-switcher
dropdown introduced in S130 / S131:
  1. From Home, double-click a connected PG connection (S134 removed
     the ConnectionSwitcher / Cmd+K popover; entry is now via Home).
  2. In the workspace, click the DB switcher trigger and verify the
     popover lists at least one database row.
  3. Select a different DB and verify the trigger label updates.

Both the PG and Mongo descriptors are gated behind the
`E2E_PG_HOST` / `E2E_MONGO_HOST` env vars.
```

원본 outline (PG):
```text
1. await pressCtrl("k");
2. await selectConnection("Test PG");
3. await openDbSwitcherPopover();
4. await assertDatabaseRowsVisible();
5. await selectDatabase("admin");
6. await expectTriggerLabel("admin");
```

원본 outline (Mongo): 동일 흐름, fixture: `E2E_MONGO_HOST`.

권위: PG sub-pool LRU 와 Mongo in-connection switch 의 store / Tauri
command 단계는 component / unit test 로 분해되어 있음 (Sprint 130/131).

후속 진입 트리거: workspace DB-switcher UI 회귀 발생 시 또는 PG
multi-database / Mongo session-pinned switch 의 user-visible 변경.

## 3. raw-query-db-change.spec.ts (파일 전체)

원본 머리주석:
```text
Sprint 133 — Raw-query DB-change detection (S132) e2e smoke test.

Exercises the backend → frontend round-trip introduced in S132: when a
user runs a raw `\c admin` (or `USE admin`) statement inside a query
tab, the backend reports the new active database via the existing
paradigm event channel and the workspace UI auto-reloads:
  - The sidebar's `SchemaTree` switches to the new database.
  - The DB switcher trigger label updates to match.

Gated behind `E2E_PG_HOST`.
```

원본 outline:
```text
1. await openTestPgWorkspace();
2. await openNewQueryTab();
3. await typeIntoEditor("\\c admin");
4. await runQuery();
5. await waitForBackendRoundTrip();
6. await expectSchemaTreeReloaded();
7. await expectDbSwitcherLabel("admin");
```

권위: Sprint 132 의 backend round-trip 자체는 store / Tauri command
unit test 로 검증됨.

후속 진입 트리거: `\c` / `USE` raw-query DB switch 의 user-visible 회귀.

## 진입 정책

후속 sprint 가 본 archive 를 입력값으로 본문 작성 시:

1. **권위 재검증** — 위 outline 의 권위 component test 가 여전히 회귀를
   잡는가? P1 (피라미드 분리) 적용 — vitest 로 끝나면 e2e 추가하지
   않음.
2. **CUJ 5종 매핑** — outline 이 e2e CUJ 5종 (연결→첫쿼리, paradigm
   전환, Home↔Workspace, 셀편집, 멀티윈도우 라이프) 중 하나에 해당하는
   가? 해당 시 `e2e/cuj/` 위치.
3. **회귀 고정 인용** — 사용자-가시 버그 보고 / sprint 인용 / ADR 인용
   을 spec 머리주석에 명시.
4. **step 라벨** — outline 의 각 단계를 `step("...")` 라벨로 변환 —
   진단성 (P8) 확보.
