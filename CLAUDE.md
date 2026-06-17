# Claude Code Entry

`AGENTS.md` 가 universal source다. Claude Code 는 이 파일을 먼저 보고,
규칙 본문은 `AGENTS.md` 와 해당 memory/docs SOT 로 내려간다.

## 프로젝트 한줄

Tauri 2.0 + React + Rust TablePlus-like 로컬 DB 도구. 다중 DBMS.

## 작업 전 read

- [`AGENTS.md`](AGENTS.md) — 작업 type -> memory path 매트릭스와 강제 룰.
- [`memory/index/by-surface.md`](memory/index/by-surface.md) — 코드/문서 수정 전
  해당 surface active rule 묶음.
- [`docs/PLAN.md`](docs/PLAN.md) — product/roadmap/contributor SOT 인덱스.
- [`.claude/rules/git-policy.md`](.claude/rules/git-policy.md) — hook/signing
  회피 금지 wrapper. 본문 source 는 `memory/workflow/git-policy/memory.md`.

## 강제 룰

- 별도 Claude 전용 정책을 여기서 만들지 않는다. 충돌 시 `AGENTS.md` 가 우선.
- `memory/` 트리 200줄 / 12,000 chars cap, `memory.md` 만.
- ADR 본문 동결. 결정 뒤집기 = 새 ADR + `Superseded`.
- `--no-verify`, `--no-gpg-sign`, `LEFTHOOK=0`, `HUSKY=0`, agent path 의
  `git push --force` 금지.
- 대화 결정은 `remember` skill 로 저장.
