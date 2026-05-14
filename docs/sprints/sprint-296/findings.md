# Sprint 296 Findings

## Result

P1: 1건 (Rust Unit CI 실패 — 플레이키 테스트)

---

## CI 실패 현상 (2026-05-14)

### [P1] Rust Unit Test — `test_export_connections_encrypted_round_trip` 간헐적 실패

| 항목 | 내용 |
| --- | --- |
| 워크플로우 | `CI / Rust Unit And Storage Tests` |
| runner | macos-15-arm64 |
| 커밋 SHA | `9d23c04347fac86be9cbc08eaaf7619065d7b257` |
| run ID | 25835616218 |
| 발생 시각 | 2026-05-14T01:10:08Z |

**실패 메시지:**
```
thread 'commands::connection::io::tests::test_export_connections_encrypted_round_trip'
panicked at src/commands/connection/io.rs:599:9:
assertion failed: !result.json.contains("DB1")

test result: FAILED. 813 passed; 1 failed; 2 ignored
```

**원인 분석:**

`export_connections_encrypted` 가 반환하는 `EncryptedEnvelope` JSON은 암호화된 ciphertext를 base64로 인코딩해 담는다. 테스트는 이 JSON 문자열에 평문 `"DB1"`이 포함되지 않아야 함을 단언한다.

```rust
// io.rs:599
assert!(!result.json.contains("DB1"));
```

그러나 base64 알파벳(`A-Z`, `a-z`, `0-9`, `+`, `/`)은 `D`, `B`, `1`을 모두 포함하므로, 무작위 AES-256-GCM ciphertext를 base64로 인코딩한 결과가 우연히 `"DB1"` 부분 문자열을 포함할 확률이 0이 아니다. 약 1 KB 페이로드 기준 추정 실패 확률 ≈ 0.5%/run.

이번 실패는 **sprint-296 변경과 무관**하다. `9d23c04`는 `io.rs`와 `crypto.rs`를 전혀 수정하지 않았으며(PG trait dispatch + MySQL DECIMAL fix + MySQL trigger coverage), 재실행 시 통과할 가능성이 높다.

**영향:**
- `continue-on-error` 미설정 → CI 차단 (main push 빨간 불)
- sprint-296 기능(MySQL DECIMAL, trigger coverage) 자체는 정상 동작

**수정 완료:**

부분 문자열 비교를 제거하고 "잘못된 비밀번호로는 복호화 실패" 어서션으로 교체했다.

```rust
// Before (flaky)
assert!(!result.json.contains("DB1"));

// After (deterministic) — io.rs:598~602
// Wrong password must be rejected — proves ciphertext is opaque
// without the key. (Substring search on base64 output is flaky:
// random ciphertext can coincidentally spell "DB1".)
assert!(
    import_connections_encrypted(result.json.clone(), "wrong passphrase".into()).is_err(),
    "wrong password must fail to decrypt"
);
```

`cargo test --lib "commands::connection::io::tests"` → **14 passed; 0 failed** ✓

---

### [참고] E2E Smoke 상태 (2026-05-14 기준)

사용자 스크린샷(GitHub checks UI)에서 `E2E Smoke / Runtime Happy Path` 가 "Failing after 4m"으로 표시됐으나, 이는 sprint-297 재구축 중간 단계 커밋(`829902d`)의 이전 run 잔상이다.

최신 run 목록 (`e2e-smoke.yml` 기준):

| 커밋 | 결론 |
| --- | --- |
| `9d23c04` (2026-05-14T01:08Z) | **success** |
| `fc118d5` (2026-05-14T00:41Z) | success |
| `b7cf3ee` (2026-05-14T00:15Z) | success |
| `413910a` (2026-05-13T23:49Z) | success |
| `829902d` (2026-05-13T23:27Z) | success |

스크린샷 시점 이후 `ci(e2e): run smoke specs independently` (`413910a`) + `ci(e2e): avoid displayed check for launcher` (`b7cf3ee`) 두 수정 커밋에서 smoke가 안정화됐다. **현재 E2E Smoke는 정상.**

---

## Acceptance Criteria Review

> sprint-296 spec.md 기준

| AC | Status | Evidence |
| --- | --- | --- |
| MySQL adapter sqlx::mysql 채택 | PASS | ADR 0028, `fc118d5` |
| PG trait dispatch 커버리지 | PASS | `test_pg_trait_dispatch_covers_rdb_adapter_surface` — 340 line |
| MySQL DECIMAL decode 버그 수정 | PASS | `sqlx bigdecimal` feature 추가, `test_mysql_query_table_data_decimal_value_is_string_wire` 활성화 |
| MySQL trigger 메소드 커버리지 | PASS | `list_triggers`/`get_trigger_source` hit |
| Coverage 임계 (80/74/81) | PASS | 84.23/79.74/85.66 |
| CI Rust Unit | **FIXED** | `test_export_connections_encrypted_round_trip` — base64 부분 문자열 어서션 → wrong-password 결정적 검증으로 교체 (`io.rs:598`) |
