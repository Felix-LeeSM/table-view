---
title: Retired dialog preset convention
type: retired
updated: 2026-05-28
---

# Retired dialog preset convention

이 방은 더 이상 active engineering rule 이 아니다.

2026-05-28 결정: Layer 2 preset 우선 규칙과 `ConnectionDialog` 단일 escape hatch
규칙은 현재 코드 사용 방식과 맞지 않으므로 비활성화한다. 실제 dialog 구현은 이미
primitive, local shell, application-specific layout 을 혼합해서 쓰고 있다. 지켜지지
않는 원칙을 active convention 으로 유지하지 않는다.

현재 active dialog invariant 는 [frontend](../memory.md)에 둔다. 이 파일은 retired
preset 규칙의 기록으로만 유지한다.

## Related

- [frontend](../memory.md)
