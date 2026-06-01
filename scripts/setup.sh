#!/usr/bin/env bash
# scripts/setup.sh — Table View 개발 환경 셋업
#
# 책임 영역:
#   1. 런타임 (node, rust, pnpm, lefthook, direnv) — mise → asdf 순으로 시도, 둘 다
#      없으면 mise 설치 안내 후 종료. .tool-versions 가 단일 진실원.
#   2. cargo 보조 도구 (cargo-binstall → cargo-llvm-cov, cargo-deny,
#      cargo-machete, cargo-nextest) + rustup 컴포넌트 (llvm-tools-preview).
#   3. core.hooksPath 활성화 + pnpm install (Phase F 에서 추가됨; 현재 초안은
#      도구 설치까지만).
#
# 멱등성: 모든 단계는 재실행해도 안전해야 한다. 이미 설치된 도구는 건너뛰고,
# `git config` 같은 단발성 설정은 같은 값으로 다시 써도 무해하다.

set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() {
  printf '\033[1;34m[setup]\033[0m %s\n' "$*"
}

err() {
  printf '\033[1;31m[setup:error]\033[0m %s\n' "$*" >&2
}

# ── 1. 런타임 ─────────────────────────────────────────────────────────────
install_runtimes() {
  if command -v mise >/dev/null 2>&1; then
    log "mise 발견 → mise install 실행"
    mise install
  elif command -v asdf >/dev/null 2>&1; then
    log "asdf 발견 → asdf install 실행 (mise 권장: https://mise.jdx.dev/)"
    # .tool-versions 의 각 plugin 이 미설치면 에러나는 것을 방지하기 위해
    # plugin add 를 best-effort 로 시도.
    while read -r plugin _version; do
      [ -z "$plugin" ] && continue
      asdf plugin add "$plugin" 2>/dev/null || true
    done < .tool-versions
    asdf install
  else
    err "mise 또는 asdf 가 필요합니다."
    err "권장: brew install mise && eval \"\$(mise activate zsh)\""
    exit 1
  fi
}

# ── 2. cargo 보조 도구 ────────────────────────────────────────────────────
ensure_cargo_binstall() {
  if command -v cargo-binstall >/dev/null 2>&1; then
    log "cargo-binstall 이미 설치됨"
    return
  fi
  log "cargo-binstall 부트스트랩 (cargo install)"
  # cargo-binstall 자체는 source 빌드가 한 번 필요하다. 이후 다른 cargo 도구는
  # binstall 로 prebuilt binary 를 받기 때문에 빠르다.
  cargo install cargo-binstall --locked
}

install_cargo_tools() {
  ensure_cargo_binstall

  # llvm-tools-preview: cargo-llvm-cov 가 의존하는 rustup 컴포넌트.
  if rustup component list --installed 2>/dev/null | grep -q '^llvm-tools'; then
    log "rustup llvm-tools-preview 이미 설치됨"
  else
    log "rustup component add llvm-tools-preview"
    rustup component add llvm-tools-preview
  fi

  # binstall 은 이미 있으면 no-op (cargo-binstall 자체가 멱등성을 보장).
  # cargo-nextest 는 pre-push Rust test/coverage 실행기로 사용한다.
  log "cargo-binstall: cargo-llvm-cov cargo-deny cargo-machete cargo-nextest"
  cargo binstall --no-confirm cargo-llvm-cov cargo-deny cargo-machete cargo-nextest
}

# ── 3. git hook 활성화 + JS 의존성 ───────────────────────────────────────
activate_hooks() {
  # core.hooksPath 가 .githooks 를 가리키도록 설정. `pnpm install` 의 prepare
  # 스크립트가 같은 명령을 실행하므로 중복이지만, setup.sh 만 단독 실행해도
  # hook 가 활성화되도록 명시적으로 한 번 더 설정한다 (bootstrap gap 해소).
  log "git config core.hooksPath .githooks"
  git -C "$REPO_ROOT" config core.hooksPath .githooks
}

install_node_deps() {
  log "pnpm install"
  pnpm install
}

# ── 메인 ─────────────────────────────────────────────────────────────────
main() {
  log "리포지토리: $REPO_ROOT"
  install_runtimes
  install_cargo_tools
  activate_hooks
  install_node_deps
  log "셋업 완료. lefthook hook 가 활성화되었습니다."
}

main "$@"
