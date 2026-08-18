#!/usr/bin/env bash
# update-homebrew-cask.sh — cask 파일의 `version` 과 `sha256` 줄만 갈아 끼운다 (#2454).
#
# 부르는 곳: `.github/workflows/release.yml` 의 `Update the tap cask` 스텝. 그
# 스텝이 tap 저장소 `Felix-LeeSM/homebrew-table-view` 를 clone 한 뒤 그 안의
# `Casks/table-view.rb` 를 이 스크립트로 고치고 push 한다.
#
# ## 왜 파일을 새로 쓰지 않는가
#
# tap 의 cask 는 `livecheck` 블록과 `caveats` 를 갖는다 (tap PR
# Felix-LeeSM/homebrew-table-view#9). `livecheck` 가 빠지면 `brew outdated` 가
# 새 버전이 있다는 사실 자체를 사용자에게 못 알린다 — 이슈 #2454 가 P1 이 된
# 사유의 절반이 그것이다. 파일을 생성하는 방식은 그것들을 조용히 지우고, 지웠다는
# 것을 알려주는 것이 없다. 그래서 두 줄만 건드린다.
#
# ## 왜 sed 한 줄이 아닌가
#
# 패턴이 안 맞으면 `sed` 는 아무것도 안 바꾸고 rc=0 을 낸다. 그러면 job 은 green
# 인데 tap 은 옛 버전 그대로 남는다 — 이 저장소가 `Upload SHA256 checksums` 에서
# 이미 한 번 당한 형태다 (#2207: v0.7.0 · v0.7.1 이 체크섬 없는 번들을 냈는데
# 스텝은 green 이었다). 그래서 여기서는 셋을 한다:
#   1. 고치기 전에 대상 줄이 정확히 하나씩 있는지 센다 (0개도 2개도 red)
#   2. 값의 형태를 먼저 검사한다 — 릴리스 경로에서 이상한 값을 tap 에 밀어 넣는
#      것보다 멈추는 쪽이 맞다
#   3. 쓴 뒤에 파일을 다시 읽어 값이 실제로 들어갔는지 확인한다
#
# 세는 줄과 읽는 줄은 같은 정규식(`key_re`)을 쓴다. 둘이 갈라지면 "1개 있다" 를
# 확인한 뒤 다른 줄을 읽는 상태가 생긴다.
#
# ## 대상 줄의 정의
#
# 줄 전체가 `<키> "<값>"` 하나인 줄. cask 의 `url` 줄은 값 안에 `#{version}` 을
# 담고 있어서(`url "…/v#{version}/Table.View_#{version}_aarch64.dmg"`) 이 정의에
# 안 걸린다 — 걸리면 URL 이 통째로 버전 문자열로 바뀐다.
#
# 한계(의도): 값은 큰따옴표 표기만 읽는다. cask 가 `version :latest` 나 arch 별
# `on_arm do … end` 블록으로 바뀌면 개수 검사에서 red 가 난다. 그때는 이 스크립트가
# 아니라 그 형태를 먼저 정해야 한다.
#
# 실행:
#   bash scripts/release/update-homebrew-cask.sh <path/to/cask.rb> <version> <sha256>
# 회귀 스위트:
#   bash scripts/release/update-homebrew-cask.test.sh

set -euo pipefail

cask="${1:?usage: update-homebrew-cask.sh <path/to/cask.rb> <version> <sha256>}"
version="${2:?usage: update-homebrew-cask.sh <path/to/cask.rb> <version> <sha256>}"
sha256="${3:?usage: update-homebrew-cask.sh <path/to/cask.rb> <version> <sha256>}"

if [ ! -f "$cask" ]; then
	echo "::error::$cask 이 없다 — tap clone 이 실패했거나 cask 경로가 바뀌었다" >&2
	exit 1
fi

# 태그에서 온 값이라 `v` 접두사가 남아 있으면 cask 가 `v0.7.1` 을 버전으로 삼고,
# url 의 `v#{version}` 이 `vv0.7.1` 이 된다. 벗기지 말고 거부한다 — 부르는 쪽이
# 무엇을 넘겼는지 드러나는 편이 낫다.
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.+-][0-9A-Za-z.-]+)?$ ]]; then
	echo "::error::version 이 '$version' 이다 — x.y.z 형태여야 한다 (태그의 'v' 는 부르는 쪽이 벗긴다)" >&2
	exit 1
fi

# GitHub API 의 asset digest 는 `sha256:<hex>` 다. 접두사째 넘어오면 cask 의
# checksum 이 통째로 틀려 `brew install` 이 SHA256 mismatch 로 죽는다.
if ! [[ "$sha256" =~ ^[0-9a-f]{64}$ ]]; then
	echo "::error::sha256 이 '$sha256' 이다 — 소문자 hex 64자여야 한다 ('sha256:' 접두사는 부르는 쪽이 벗긴다)" >&2
	exit 1
fi

key_re() { printf '^[[:space:]]*%s[[:space:]]+"[^"]*"[[:space:]]*$' "$1"; }

count_key() { awk -v re="$(key_re "$1")" '$0 ~ re { n++ } END { print n + 0 }' "$2"; }

read_key() {
	awk -v re="$(key_re "$1")" '$0 ~ re && match($0, /"[^"]*"/) {
		print substr($0, RSTART + 1, RLENGTH - 2)
		exit
	}' "$2"
}

for key in version sha256; do
	n="$(count_key "$key" "$cask")"
	if [ "$n" != "1" ]; then
		echo "::error::$cask 에 \`$key \"…\"\` 꼴의 줄이 $n 개다 (1개여야 한다). cask 형태가 바뀌었으니 갈아 끼우지 않고 멈춘다 — 못 바꾼 채 green 으로 끝나면 tap 이 옛 버전으로 남는다" >&2
		exit 1
	fi
done

tmp="$(mktemp "${TMPDIR:-/tmp}/update-homebrew-cask.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

awk -v vre="$(key_re version)" -v sre="$(key_re sha256)" -v ver="$version" -v sum="$sha256" '
	$0 ~ vre { sub(/"[^"]*"/, "\"" ver "\"") }
	$0 ~ sre { sub(/"[^"]*"/, "\"" sum "\"") }
	{ print }
' "$cask" >"$tmp"

# `mv` 가 아니라 내용 덮어쓰기 — 파일의 mode 와 inode 를 그대로 둔다.
cat "$tmp" >"$cask"

got_version="$(read_key version "$cask")"
got_sha256="$(read_key sha256 "$cask")"
if [ "$got_version" != "$version" ] || [ "$got_sha256" != "$sha256" ]; then
	echo "::error::치환이 안 들어갔다 — $cask 이 version='$got_version' sha256='$got_sha256' 이다 (기대: '$version' / '$sha256')" >&2
	exit 1
fi

printf '%s: version=%s sha256=%s\n' "$cask" "$version" "$sha256"
