#!/usr/bin/env bash
# lib/locale-utf8.sh — sourced module (순수 함수 정의, top-level 부작용 없음).
# wc -m 이 멀티바이트를 문자 수로 세도록 LC_ALL 을 UTF-8 계열로 보장.
# 소비: scripts/hooks/check-memory-size.sh, scripts/hooks/check-doc-size.sh.

ensure_utf8_locale() {
	# LC_ALL 이 이미 UTF-8 계열이면 존중, 그 외(C 등)/비어있으면 가용 locale 로 override.
	# (UTF-8 locale 이 전혀 없는 POSIX-only minimal 환경에서는 폴백이 no-op →
	#  한국어 false-positive 가능. macOS / GH Actions ubuntu 는 기본 C.UTF-8 보유.)
	case "${LC_ALL:-}" in
		*UTF-8*|*utf8*) return 0 ;;
	esac
	for _l in en_US.UTF-8 en_US.utf8 C.UTF-8 C.utf8; do
		# producer(locale -a)가 grep -q 의 early-close 로 SIGPIPE(141)를 받는 것을
		# 삼킨다. pipefail 하에서 producer 의 non-zero exit 이 파이프 전체를 실패로
		# 만들어, 매칭에 성공해도 폴백이永不 진입하는(LC_ALL=C 가 유지되어 wc -m 이
		# 한국어를 바이트 수로 세는) 회귀를 방지한다.
		if { locale -a 2>/dev/null || true; } | grep -qix "$_l"; then LC_ALL="$_l"; export LC_ALL; return 0; fi
	done
}
