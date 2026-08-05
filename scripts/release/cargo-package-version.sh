#!/usr/bin/env bash
# cargo-package-version.sh — Cargo 매니페스트의 `[package]` 섹션 version 을 낸다 (#2169).
#
# 부르는 곳: `.github/workflows/auto-tag-release.yml` 의 "Tag release if version
# bumped" 스텝. 그 스텝은 tauri.conf.json · src-tauri/Cargo.toml · package.json 세 SOT 의
# 버전이 같을 때만 태그를 민다 — 이 값이 틀리면 릴리스가 틀린 값으로 대조한다.
#
# 왜 grep 한 줄이 아닌가:
#   ① 섹션을 봐야 한다. `[workspace.package]` (#2161) 이 생기면 그 섹션의
#      version 이 파일 앞쪽에 올 수 있고, 첫 `version` 줄을 잡는 파싱은 그것을
#      잡는다. red 가 아니라 잘못된 green 이다.
#   ② 값 뒤 주석에 따옴표가 있을 수 있다. 행의 마지막 따옴표 문자열을 잡는
#      greedy 파싱은 주석 쪽 값을 낸다.
#
# 한계(의도): 값은 큰따옴표 표기만 읽는다 — cargo 가 쓰는 표기다. 작은따옴표
# 리터럴이나 `version.workspace = true` 는 "못 찾았다"로 보고 exit 1 한다.
# 릴리스 경로에서는 빈 값을 흘리는 것보다 멈추는 쪽이 맞다.
#
# 실행:
#   bash scripts/release/cargo-package-version.sh src-tauri/Cargo.toml
# 회귀 스위트:
#   bash scripts/release/cargo-package-version.test.sh

set -euo pipefail

manifest="${1:?usage: cargo-package-version.sh <path/to/Cargo.toml>}"

if [ ! -f "$manifest" ]; then
	echo "::error::$manifest 이 없다" >&2
	exit 1
fi

# 섹션 헤더를 만날 때마다 `[package]` 안인지 갱신하고, 그 안의 첫 `version =`
# 줄에서 **첫** 따옴표 문자열만 낸다. `version.workspace` 처럼 `=` 앞에 다른
# 글자가 붙는 키는 매치되지 않는다.
version="$(awk '
	/^[[:space:]]*\[/ { pkg = ($0 ~ /^[[:space:]]*\[package\][[:space:]]*(#.*)?$/); next }
	pkg && /^[[:space:]]*version[[:space:]]*=/ {
		sub(/^[^=]*=/, "")
		if (match($0, /"[^"]*"/)) {
			print substr($0, RSTART + 1, RLENGTH - 2)
			exit
		}
	}
' "$manifest")"

if [ -z "$version" ]; then
	echo "::error::$manifest 의 [package] 섹션에서 version 을 못 찾았다 — 다른 섹션의 version 은 대체가 아니다 (#2169)" >&2
	exit 1
fi

printf '%s\n' "$version"
