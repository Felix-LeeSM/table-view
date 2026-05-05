# Sprint 207 — Contract

Sprint: `sprint-207` (refactor — Rust prod `expect` 정책 결정 후 처리).
Date: 2026-05-05.
Type: refactor (행동 변경 0; panic → 명시적 종료 / invariant 디펜시브).

[`docs/PLAN.md`](../../PLAN.md) Sprint 207 row + [`/CODE_SMELLS.md`](../../../CODE_SMELLS.md) §7.
짧은 sprint. prod `expect` 5곳 정리.

## 배경

CODE_SMELLS §7: prod 경로의 `.expect("...")` 5곳. Rust 컨벤션
(`memory/conventions/...` rust-conventions: "`unwrap()` 사용 금지 (테스트
코드 제외)") 적용 시 `expect` 도 동일 정신.

5곳 분류:

| 카테고리 | 갯수 | 정책 |
|----------|------|------|
| **Tauri 초기화 치명 오류** | 2 | `expect` panic → `Result` match + `tracing::error!` + `std::process::exit(1)` |
| **Invariant assumption** | 3 | `expect` panic → `let Some else` / `if let Some` 디펜시브 패턴 |

## Sprint 안에서 끝낼 단위

### lib.rs 2곳 — Tauri 치명 오류

`src-tauri/src/lib.rs:280` (macOS build) / `:307` (non-macOS run).

기존:
```rust
let app = builder
    .build(context)
    .expect("error while building tauri application");
```

신규:
```rust
let app = match builder.build(context) {
    Ok(app) => app,
    Err(e) => {
        tracing::error!(target: "boot", "failed to build Tauri application: {e}");
        eprintln!("[table-view] Failed to start: {e}");
        std::process::exit(1);
    }
};
```

차이:
- `panic` 대신 `exit(1)` — backtrace 노출 없이 친화적 종료.
- `tracing::error!` 로 log channel 에 기록 (이후 file logging / telemetry 도입 시 자동 포함).
- `eprintln!` 으로 stderr 도 — terminal 에서 실행 시 사용자가 볼 수 있는 메시지.

`run` (line 307) 도 동일 패턴. macOS 분기와 non-macOS 분기 동시 적용.

### postgres/mutations.rs:27 — invariant 디펜시브

기존:
```rust
let mut chars = trimmed.chars();
let first = chars.next().expect("checked non-empty");
```

신규:
```rust
let mut chars = trimmed.chars();
let Some(first) = chars.next() else {
    // Unreachable: the `is_empty()` check above guarantees a leading
    // char. We surface a Validation error instead of panicking on an
    // invariant break.
    return Err(AppError::Validation(format!("{} must not be empty", label)));
};
```

cost: zero (let-else 는 zero-cost 패턴). 이득: invariant 위반 시 panic
대신 caller 가 처리할 Validation error.

### mongodb/schema.rs:138, 144 — invariant 디펜시브

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

invariant: line 132-137 의 `if !type_counts.contains_key(k)` 블록이
4 HashMap 동기화를 보장 — `if let Some` else 분기는 도달 불가능. 그러
나 `expect` panic 대신 silent skip 으로 안전화. cost zero.

## Acceptance Criteria

### AC-207-01 — prod `expect` 5곳 0건

`grep -rnE "\.expect\(\"" --include="*.rs" src-tauri/src/` 결과에서 본
5곳:
- `lib.rs:280` (build)
- `lib.rs:307` (run)
- `postgres/mutations.rs:27`
- `mongodb/schema.rs:138`
- `mongodb/schema.rs:144`

→ 0 매치. (테스트 코드의 `.expect` 는 본 sprint 범위 외, 다수 보존.)

### AC-207-02 — 회귀 0

- `cargo build --manifest-path src-tauri/Cargo.toml` exit 0.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` exit 0.
- `cargo test --manifest-path src-tauri/Cargo.toml` 기존 테스트 모두 pass.
- 신규 회귀 테스트 0 — invariant 디펜시브 분기는 도달 불가능 (테스트
  불가). lib.rs 의 build/run 실패 분기는 mock app builder 의존 — 본
  sprint 범위 외.

### AC-207-03 — 행동 변경 0

- `validate_identifier` 의 외부 동작 (정상 입력에 대한 결과) 동일.
- `infer_columns_from_samples` 의 정상 sample 에 대한 결과 동일.
- Tauri build/run 정상 분기 동일 — 실패 시 panic vs exit(1) 차이만.

## Out of scope

- **테스트 코드 `.expect`** — 27곳 정도 검출됨. 테스트는 invariant
  panic 이 정상 동작 (실패 시 빠른 진단). 본 sprint 미적용.
- **`tracing::error!` 추가 외 logging 인프라** — file logging, telemetry
  channel 등은 별도 sprint.
- **`debug_assert!` 추가** — release 에서 disable 되는 assertion. 본
  sprint 는 디펜시브 패턴 (let-else / if-let) 으로 통일.
- **mongodb/schema.rs 의 `entry().or_default()` 리팩터** — line 132-137
  의 `if !contains_key` 블록을 entry API 로 통일하면 더 idiomatic 이지
  만 큰 리팩터. expect 제거만 본 sprint 의 작업.

## 검증 명령

```sh
cargo build --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
grep -rnE "\.expect\(\"" --include="*.rs" src-tauri/src/lib.rs src-tauri/src/db/postgres/mutations.rs src-tauri/src/db/mongodb/schema.rs
pnpm tsc --noEmit
pnpm lint
pnpm vitest run
```

기대값: cargo build / clippy / test 0 error / 5 prod expect 0 매치 (테스트
expect 는 보존) / tsc 0 / lint 0 / vitest 189 files 2732 tests pass.
