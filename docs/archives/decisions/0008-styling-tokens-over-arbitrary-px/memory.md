---
id: 0008
title: Tailwind 크기·간격은 @theme 토큰 + v4 기본 스케일로 표현, arbitrary px는 로컬 ESLint 룰로 차단
status: Accepted
date: 2026-04-24
supersedes: null
superseded_by: null
---

**결정**: size·spacing 계열 utility에서 arbitrary `[Npx]` 값을 금지하고, 반복되는 값은 `@theme inline`의 semantic 토큰(예: `text-3xs`, `w-dialog-md`) 또는 Tailwind v4 기본 `--spacing` 정수 스케일(예: `max-w-50`)로 표현하며, 로컬 ESLint 룰 `tv-local/no-tailwind-arbitrary-px`로 신규 도입을 error 차단한다.
**이유**: arbitrary px는 rem 기반 접근성(사용자 글꼴 확대)을 깨고 반복되는 값의 디자인 의도를 숨기며, `eslint-plugin-tailwindcss`는 v4 호환이 아직 불안정해 의존성 없는 AST 기반 로컬 룰이 유지비가 가장 낮다.
**트레이드오프**: + 디자인 의도가 클래스명에 드러남, rem 기반 유지, CI-blocker로 재발 방지, 외부 의존성 0 / - semantic 토큰 vs 기본 스케일 선택에 판단 필요, 플러그인 생태계 혜택 없음, shadcn/ui의 `ring-[3px]` 등은 룰 화이트리스트(size utility prefix 제한)로 관리해야 함.
