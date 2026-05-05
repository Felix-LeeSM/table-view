# Sprint 207 — Findings

prod `.expect("...")` 5곳 정리. panic → 명시적 종료 / 디펜시브 패턴.
행동 변경 0.

## §1 — 처리 결과

| 분류 | 갯수 | 정책 |
|------|------|------|
| Tauri 초기화 치명 오류 | 2 | `Result` match + `tracing::error!` + `std::process::exit(1)` |
| Invariant assumption | 3 | `let Some else` / `if let Some` 디펜시브 패턴 |

## §2 — lib.rs 2곳 (Tauri 초기화)

`src-tauri/src/lib.rs:280` (macOS build) + `:307` (non-macOS run).

기존 panic 의 사용자 가시성:
- macOS: stderr backtrace + 즉시 종료 — 사용자는 "앱이 그냥 죽음" 으로 인지.
- non-macOS: 동일.

신규 동작:
- `match` / `if let Err` → `tracing::error!(target: "boot", ...)` + `eprintln!` + `std::process::exit(1)`.
- `tracing` 으로 로깅 — 향후 file logger / telemetry channel 추가 시 자동 포함.
- `eprintln!` 으로 stderr 직접 출력 — terminal 실행 시 사용자 가시.
- `exit(1)` — non-zero exit code, backtrace 노출 없이 정상 종료.

차이는 정책적 — panic = "예상치 못한 invariant 위반", `Err + exit` = "예상
가능한 실패의 친화적 종료". Tauri 초기화 실패는 후자 카테고리.

## §3 — postgres/mutations.rs:27 (validate_identifier)

기존:
```rust
let mut chars = trimmed.chars();
let first = chars.next().expect("checked non-empty");
```

신규:
```rust
let mut chars = trimmed.chars();
let Some(first) = chars.next() else {
    // Unreachable: `is_empty()` above guarantees a leading char.
    // Surface Validation rather than panic on invariant break.
    return Err(AppError::Validation(format!("{} must not be empty", label)));
};
```

cost: zero (let-else 는 zero-cost). 이득: invariant 위반 시 panic 대신
caller 가 처리할 Validation error.

## §4 — mongodb/schema.rs:138, 144 (infer_columns_from_samples)

기존:
```rust
*presence_count.get_mut(k).expect("inserted above") += 1;
match v {
    Bson::Null => { ... }
    _ => {
        let by_type = type_counts.get_mut(k).expect("inserted above");
        *by_type.entry(bson_type_name(v)).or_insert(0) += 1;
    }
}
```

신규:
```rust
// The `if !contains_key` block above synchronizes all four
// HashMaps, so these `get_mut` calls are guaranteed `Some` —
// we still pattern-match defensively to avoid panicking on an
// invariant break.
if let Some(c) = presence_count.get_mut(k) {
    *c += 1;
}
match v {
    Bson::Null => { ... }
    _ => {
        if let Some(by_type) = type_counts.get_mut(k) {
            *by_type.entry(bson_type_name(v)).or_insert(0) += 1;
        }
    }
}
```

invariant 보장은 line 132-137 의 `if !type_counts.contains_key(k)` 블록.
4 HashMap (`type_counts`, `presence_count`, `has_null`, `order`) 동기화.
`if let Some` 의 None 분기는 도달 불가능 — 그러나 panic 대신 silent skip
으로 안전화.

`entry().or_default()` API 로 통일도 가능하지만 큰 리팩터 (Out of scope).

## §5 — 검증 결과

| 항목 | 결과 |
|------|------|
| `cargo build` | exit 0 |
| `cargo clippy --all-targets --all-features -- -D warnings` | exit 0 |
| `cargo test` | unit + integration + doc-tests 모두 pass |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm vitest run` | 189 files / 2732 tests pass |
| 5 prod `expect` grep | 0 매치 |

baseline: Sprint 206 = 189 files / 2732 tests. 회귀 0.

## §6 — Out-of-scope

- **테스트 코드 `.expect`** — 약 27곳 검출 (테스트 setup, assertion).
  테스트는 invariant panic 이 정상 — 빠른 진단 목적. 본 sprint 미적용.
- **`tracing::error!` 추가 외 logging 인프라** — file logging,
  telemetry channel 도입은 별도 sprint.
- **`debug_assert!` 추가** — release 에서 disable. 본 sprint 는 디펜시브
  패턴 (let-else / if-let) 으로 통일.
- **`entry().or_default()` 리팩터** — `infer_columns_from_samples` 의
  4 HashMap 동기화를 entry API 로 일원화 가능. expect 제거만 본 sprint.

## §7 — CODE_SMELLS §7 처리

§7 의 본질 ("프로덕션의 강제 종료 지점이 사용자에게 친화적이지 않음" +
"가정 기반 expect 가 release 에서 폭발 가능") 은 5곳 처리 완료. 잔존
prod expect 0건. 테스트 코드 expect 는 정상 사용으로 보존.
