# sprint-411 — command registry split

## Scope

Move the Tauri command registration list out of `src-tauri/src/lib.rs` into a
dedicated command registry module. Preserve the default Wry runtime, command
names, command signatures, and existing builder phase instrumentation.

## Acceptance Criteria

- AC-411-01: `src-tauri/src/commands/registry.rs` exposes
  `register_all(builder)`.
- AC-411-02: `src-tauri/src/lib.rs` registers commands through one
  `commands::registry::register_all(builder)` call.
- AC-411-03: every previously registered command remains present in the
  `tauri::generate_handler!` list.
- AC-411-04: command modules remain reachable through `commands::mod`.
- AC-411-05: `lib.rs` no longer owns the command list hot spot.
- AC-411-06: Rust formatting, cargo check, clippy, and relevant tests pass.

## Non-Goals

- Do not change any Tauri command name, parameter type, return type, or frontend
  invoke key.
- Do not reorder lifecycle setup, managed state registration, window events,
  setup hooks, page-load hooks, or boot instrumentation.
- Do not split macOS menu handling or boot tasks in this sprint.
