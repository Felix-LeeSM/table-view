---
title: gpg 서명 필수 repo 에서 agent commit 은 gpg-agent 캐시가 살아 있는 동안만 성공 — 만료되면 pinentry 가 비대화형 세션을 막음
type: lesson
date: 2026-04-24
---

**상황**: Sprint 79 staged diff 를 agent 가 `git commit -m "…"` 시도 → lefthook 훅은 전부 통과했지만 `gpg: signing failed: Timeout` (pinentry-curses 가 ttys001 에 뜬 채 passphrase 미입력). 재시도 동일 실패.
**원인**: gpg-agent 의 passphrase 캐시가 만료된 상태라 pinentry 가 인간 TTY 대기로 진입 — agent 는 비대화형이라 입력 경로 없음. 반대로 사용자가 직전에 로컬에서 서명해 캐시가 살아 있는 윈도우 안에서는 agent commit 이 정상 성공한다.
**재발 방지**: 서명 필수 repo 에서 agent commit 을 쓰려면 (a) 사용자가 작업 시작 전 로컬에서 한 번 서명해 gpg-agent 캐시를 warm up 시키거나, (b) 캐시 만료 타임아웃이 긴 설정을 쓰고, (c) 캐시가 식은 상태에서 timeout 발생하면 즉시 agent 재시도 루프를 멈추고 commit message 를 사용자에게 핸드오프.
