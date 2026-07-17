# Retired dialog preset convention (2026-05-28)

Historical snapshot. This convention is inactive; kept only as a record of why
the Layer 2 preset rule was dropped. Active dialog invariants live in
`memory/engineering/conventions/frontend/memory.md`.

2026-05-28 결정: Layer 2 preset 우선 규칙과 `ConnectionDialog` 단일 escape hatch
규칙은 당시 코드 사용 방식과 맞지 않아 비활성화했다. 실제 dialog 구현은 이미
primitive, local shell, application-specific layout 을 혼합해서 쓰고 있었고,
지켜지지 않는 원칙을 active convention 으로 유지하지 않기로 했다.

원본은 `memory/engineering/conventions/frontend/dialogs/memory.md` (retired room)
였고, 2026-07-17 memory 소규모 정리(#1033)에서 고아 retired 방을 archives 로
이관했다.
