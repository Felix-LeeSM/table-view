---
paths:
  - "**"
---

# Git 정책 (자동 로드)

## 절대 금지 — Hook 회피

**`git commit --no-verify` / `git push --no-verify`는 어떤 상황에서도 사용 금지.**
**환경 변수 `LEFTHOOK=0`, `LEFTHOOK_SKIP=...`, `HUSKY=0` 등 hook 비활성화도 금지.**

이유:
- pre-commit (`cargo fmt`, `cargo clippy -D warnings`, `prettier`, `eslint`, secret scan)는 **품질 기준선**.
- pre-push (`cargo test`, `npm run test`, `npm run lint`, `cargo check`, **e2e**)는 **회귀 가드**.
- ADR 0019 (2026-05-01) 이후 e2e는 CI에서 제거되어 pre-push가 **유일한 e2e 게이트**다.
  hook을 우회하면 회귀가 production 빌드에 직접 반영됨.

## 강제 메커니즘

다음 두 레이어로 회피를 차단한다:

1. **Claude Code Bash hook** — `.claude/hooks/pre-bash.sh`의 `DANGEROUS_PATTERNS`에
   `--no-verify`, `LEFTHOOK=0`이 등록되어 있어 `Bash` tool 호출을 차단한다.
   `git commit` / `git push` 명령은 lefthook 바이너리와 git hook 파일 존재 여부도
   검사한다 (`check_git_hooks`).
2. **본 정책 문서** — 사람/에이전트 모두에게 명문화된 규칙.

## Hook 실패 시

`pre-commit` 또는 `pre-push`가 실패하면 **회피하지 말고 근본 원인을 고친다.**

- 포맷 실패 → `cargo fmt` / `npx prettier --write` 실행 후 재커밋
- 린트 실패 → 경고 수정. `// eslint-disable-next-line`은 분명한 사유 + 코멘트와 함께만.
- 테스트 실패 → 테스트가 옳다면 코드 수정. 테스트가 틀렸다면 테스트 수정 + ADR/sprint 코멘트.
- e2e cold-boot timeout → `e2e/_helpers.ts`의 timeout 값 검토, `wdio.conf.ts`의 mocha
  timeout 검토. `scripts/e2e-host.sh`의 docker daemon/psql 사전조건 확인.

## 예외 (사용자가 명시 승인 시에만)

- 다음 두 경우에 한해 사용자가 채팅에서 **명시적**으로 `--no-verify를 써` 또는
  `hook 건너뛰어` 라고 지시했을 때만 허용된다:
  1. CI에서 이미 검증된 머지 커밋 백포팅(예: revert, cherry-pick 충돌 해결).
  2. 시스템 장애 복구(예: hook 자체가 손상되어 재설치 필요할 때, `lefthook install`을
     포함한 메타 커밋).
- 이 경우에도 다음을 동반한다: (a) 회피 사유를 commit body에 1줄 기록,
  (b) 후속 커밋에서 회피한 검사를 통과시키는 변경 push, (c) `memory/lessons/`에
  사유 기록.

## 관련

- ADR 0019 — E2E를 CI에서 제거하고 pre-push로 이동
- ADR 0020 — pre-push e2e는 host docker로 한정 (tauri-driver macOS 미지원)
- `.claude/hooks/pre-bash.sh` — 차단 패턴 코드
- `lefthook.yml` — hook 정의 (pre-push `5_e2e: pnpm test:e2e:docker`)
