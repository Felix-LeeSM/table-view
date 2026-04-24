---
title: React `autoFocus`는 form control에만 동작 — 비-form 요소는 ref + useEffect 필요
type: lesson
date: 2026-04-24
---

**상황**: NULL 칩(`<div role="textbox" tabIndex={0}>`)과 `<input>`을 `editValue === null`로 분기 렌더하다 보니, Cmd+Backspace로 `<input>` → 칩 flip 시 포커스를 잃어 키보드 연속 편집이 끊김.
**원인**: React의 `autoFocus` prop은 form control(input/textarea/select/button)에만 mount 시 `.focus()`를 호출하고, `<div>`엔 HTML attribute로만 패스스루돼 효력이 없음.
**재발 방지**: 비-form 요소가 활성 포커스 대상일 때는 공유 ref + 포커스 대상 전이 dep(예: `[editingCell, isNullEditor]`)에 반응하는 `useEffect`로 명시적 `.focus()` 호출.
