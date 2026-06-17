---
name: pr-create
description: PR 생성 시 사용. PULL_REQUEST_TEMPLATE 기반으로 body를 조립하고 check-pr-body.mjs 로컬 검증 → PASS 시 gh pr create. CI re-push 낭비 차단.
---

# PR Create

PR body contract(`scripts/hooks/check-pr-body.mjs`, CI `PR Body Contract` job)를
**push 전**에 충족시켜, CI fail → body 재작성 → re-push 사이클을 없앤다.
`gh pr create` CLI는 `.github/PULL_REQUEST_TEMPLATE.md`를 자동 적용하지 않으므로,
이 skill이 template을 읽어 채우고 로컬에서 검증한 뒤 생성한다.

## Inputs

1. 변경 diff(`git diff main...HEAD`).
2. 실행한 정량 check 결과(test/lint/typecheck).
3. sprint contract(있으면 `docs/sprints/sprint-<N>/contract.md`).
4. 관련 active memory/docs.

## Steps

1. **template read** — `.github/PULL_REQUEST_TEMPLATE.md`(7섹션 SOT). HTML comment
   가이드(`<!-- ... -->`)는 body에서 제거.
2. **섹션 채우기**:
   - `## Summary` — 한두 문장.
   - `## Changes` — repo-relative path 또는 bullet.
   - `## Invariants` — 보존할 사용자 동작/data/API/workflow invariant.
   - `## Test plan` — 실행한 check, 또는 해당 없음 사유.
   - `## Smoke impact` — `Smoke-Test-Plan:` **같은 줄**에 값. 셋 중 하나:
     `Added/updated smoke: <path>` · `Covered by existing smoke: <spec>` ·
     `Not required: <reason>`. (check-pr-body.mjs 가 같은 줄 값을 요구.)
   - `## Documentation impact` — 4 필드 한 줄씩:
     `- Required: yes|no` / `- Trigger: <user-facing|contract|workflow|safety|ops|architecture|risk|none>`
     / `- Updated SOT: <repo-relative path, or n/a>` / `- Reason: <판단 근거>`.
   - `## Links` — issue/ADR/sprint/CI/관련 PR.
3. **로컬 검증** — 조립 body를 임시 파일로:
   `node scripts/hooks/check-pr-body.mjs --body-file <tmp>`.
   - `PASS` → 다음 단계.
   - `FAIL` → 누락 섹션/필드 메시지 읽고 채운 뒤 재검증. 반복.
4. **생성** — `gh pr create --body-file <tmp>` (title 은 Conventional Commits).

## Boundaries

- 로컬 절대경로(`/Users`, `/tmp`, `file://`, `worktrees/`) evidence 금지 —
  check-pr-body.mjs FAIL 원인. repo-relative path 또는 GitHub URL 만.
- template heading(7섹션 이름) 변경 금지. 값만 채운다.
- `Documentation impact / Required` 가 `no` 여도 `Reason` 필수(documentation gate).
- 임시 body 파일은 생성 커맨드 뒤 정리.

## Related

- `.github/PULL_REQUEST_TEMPLATE.md` — 7섹션 template (SOT)
- `scripts/hooks/check-pr-body.mjs` — contract 검증 (SOT, 본 skill 은 중복不)
- `memory/workflow/documentation/memory.md` — Documentation impact gate
- `memory/workflow/delivery/memory.md` — T3 PR 단계
