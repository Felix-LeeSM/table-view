# Claude Code 진입점

본문은 `AGENTS.md` (universal) 1번 read.

## 프로젝트 한줄

Tauri 2.0 + React + Rust TablePlus-like 로컬 DB 도구. 다중 DBMS.

## 작업 전 read

- [`AGENTS.md`](AGENTS.md) — 작업 type → memory path 매트릭스
- [`memory/memory.md`](memory/memory.md) — 팔레스 입구
- [`.claude/rules/git-policy.md`](.claude/rules/git-policy.md) — hook 회피 금지

## 강제 룰 (전역)

- `memory/` 트리 200줄 cap, `memory.md` 만.
- ADR 본문 동결. 결정 뒤집기 = 새 ADR + `Superseded`.
- `--no-verify`, `LEFTHOOK=0`, sandbox 내 `git push --force` 금지.
- `/remember` 로 대화 결정 저장.
