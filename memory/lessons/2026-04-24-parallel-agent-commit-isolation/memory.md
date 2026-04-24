---
title: 병렬 harness agent 진행 중 commit scope 격리
type: lesson
date: 2026-04-24
---

**상황**: 여러 harness agent 가 동시에 작업 중인 working tree 에서 `git add -A` / `git add .` 가 다른 agent 의 미완성 변경을 본인 커밋에 섞어버림 (Sprint 70~73 진행 시 Sprint 74/75/76 agent 의 uncommitted modifications 와 untracked 파일이 working tree 에 공존).
**원인**: `git` working tree 는 세션·agent 간 공유라 staging 단계에서 경로 격리가 필수. staging 명령어가 암묵적 "모두" 일 경우 교차오염 발생.
**재발 방지**: commit 전 `git status --short` 로 전체 변경 목록 확인 → `git add <explicit path1> <path2> ...` 로 본인 scope 파일만 명시 staging → `git status --short` 한 번 더 돌려 `?? <타 agent 파일>` 과 ` M <타 agent 수정>` 이 unstaged 로 남아있는지 검증 후 commit.
