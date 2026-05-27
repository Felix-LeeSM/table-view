#!/usr/bin/env bash
# check-memory-adr.sh
# docs/archives/decisions/*/memory.md ADR 파일의 프론트매터 정합성 검사.
#  - 필수 필드: id, title, status, date
#  - status 화이트리스트: Accepted | Deprecated | Superseded
#  - id와 디렉토리 번호 일치
#  - supersedes ↔ superseded_by 상호 링크 정합성
# 기본: 경고만 (exit 0). --strict 시 위반 있으면 exit 1.

set -euo pipefail

STRICT=0
for arg in "$@"; do
	case "$arg" in
		--strict) STRICT=1 ;;
	esac
done

if [ ! -d "docs/archives/decisions" ]; then
	exit 0
fi

violations=0

# 프론트매터에서 특정 키 값 추출 (공백 제거, 따옴표 제거).
# $1: 파일 경로, $2: 키 이름
extract_field() {
	local file="$1"
	local key="$2"
	awk -v key="$key" '
		BEGIN { in_fm = 0; found = 0 }
		NR == 1 && /^---[[:space:]]*$/ { in_fm = 1; next }
		in_fm && /^---[[:space:]]*$/ { exit }
		in_fm {
			if (match($0, "^"key"[[:space:]]*:[[:space:]]*")) {
				val = substr($0, RLENGTH + 1)
				gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
				gsub(/^"|"$/, "", val)
				gsub(/^'"'"'|'"'"'$/, "", val)
				print val
				found = 1
				exit
			}
		}
	' "$file"
}

adr_list="$(mktemp "${TMPDIR:-/tmp}/memory-adr-files.XXXXXX")"
trap 'rm -f "$adr_list"' EXIT

find docs/archives/decisions -mindepth 2 -maxdepth 2 -name "memory.md" -type f | sort > "$adr_list"

if [ ! -s "$adr_list" ]; then
	exit 0
fi

find_file_by_id() {
	local search_id="$1"
	local candidate
	while IFS= read -r candidate; do
		local dir_name
		local dir_id
		dir_name="$(basename "$(dirname "$candidate")")"
		dir_id="${dir_name%%-*}"
		if [ "$dir_id" = "$search_id" ]; then
			printf '%s\n' "$candidate"
			return 0
		fi
	done < "$adr_list"
	return 1
}

ids_from_field() {
	printf '%s\n' "$1" |
		tr ',' '\n' |
		sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e '/^$/d' -e '/^null$/d'
}

id_in_field() {
	local search_id="$1"
	local field="$2"
	local ids
	local item
	ids="$(ids_from_field "$field")"
	[ -n "$ids" ] || return 1
	while IFS= read -r item; do
		if [ "$item" = "$search_id" ]; then
			return 0
		fi
	done <<EOF
$ids
EOF
	return 1
}

while IFS= read -r file; do
	dir_name="$(basename "$(dirname "$file")")"
	dir_id="${dir_name%%-*}"

	id=$(extract_field "$file" "id")
	title=$(extract_field "$file" "title")
	status=$(extract_field "$file" "status")
	date=$(extract_field "$file" "date")
	supersedes=$(extract_field "$file" "supersedes")
	superseded_by=$(extract_field "$file" "superseded_by")

	# 필수 필드 검사
	for kv in "id:$id" "title:$title" "status:$status" "date:$date"; do
		key="${kv%%:*}"
		val="${kv#*:}"
		if [ -z "$val" ]; then
			echo "⚠️  ADR frontmatter: $file — 필수 필드 '$key' 누락."
			violations=$((violations + 1))
		fi
	done

	# id ↔ 디렉토리 번호 일치
	if [ -n "$id" ] && [ "$id" != "$dir_id" ]; then
		echo "⚠️  ADR id 불일치: $file — id=$id 이지만 디렉토리는 $dir_id 로 시작."
		violations=$((violations + 1))
	fi

	# status 화이트리스트
	case "$status" in
		Accepted|Deprecated|Superseded|"") ;;
		*)
			echo "⚠️  ADR status: $file — 허용되지 않은 값 '$status' (Accepted|Deprecated|Superseded 중 하나여야 함)."
			violations=$((violations + 1))
			;;
	esac

	# Superseded 상태면 superseded_by 필수
	if [ "$status" = "Superseded" ] && { [ -z "$superseded_by" ] || [ "$superseded_by" = "null" ]; }; then
		echo "⚠️  ADR status: $file — status=Superseded 이지만 superseded_by 가 비어 있음."
		violations=$((violations + 1))
	fi

done < "$adr_list"

# 상호 링크 정합성
while IFS= read -r file; do
	id=$(extract_field "$file" "id")
	sup=$(extract_field "$file" "supersedes")
	supby=$(extract_field "$file" "superseded_by")

	sup_ids="$(ids_from_field "$sup")"
	if [ -n "$sup_ids" ]; then
		while IFS= read -r sup_id; do
			[ -n "$sup_id" ] || continue
			target_file="$(find_file_by_id "$sup_id" || true)"
		if [ -z "$target_file" ]; then
			echo "⚠️  ADR supersedes: $file — supersedes=$sup_id 를 찾을 수 없음."
			violations=$((violations + 1))
		else
			target_supby=$(extract_field "$target_file" "superseded_by")
			target_status=$(extract_field "$target_file" "status")
			if ! id_in_field "$id" "$target_supby"; then
				echo "⚠️  ADR 상호 링크: $file(id=$id) 가 $sup_id 을 supersede 하지만, $target_file 의 superseded_by 는 '$target_supby' (기대: $id)."
				violations=$((violations + 1))
			fi
			if [ "$target_status" != "Superseded" ]; then
				echo "⚠️  ADR 상호 링크: $target_file — 다른 ADR($id)에 의해 superseded 되었으므로 status 를 Superseded 로 갱신하세요 (현재: '$target_status')."
				violations=$((violations + 1))
			fi
		fi
		done <<EOF
$sup_ids
EOF
	fi

	supby_ids="$(ids_from_field "$supby")"
	if [ -n "$supby_ids" ]; then
		while IFS= read -r supby_id; do
			[ -n "$supby_id" ] || continue
			target_file="$(find_file_by_id "$supby_id" || true)"
		if [ -z "$target_file" ]; then
			echo "⚠️  ADR superseded_by: $file — superseded_by=$supby_id 를 찾을 수 없음."
			violations=$((violations + 1))
		else
			target_sup=$(extract_field "$target_file" "supersedes")
			if ! id_in_field "$id" "$target_sup"; then
				echo "⚠️  ADR 상호 링크: $file(id=$id) 가 $supby_id 에 의해 superseded 되었다고 주장하지만, $target_file 의 supersedes 는 '$target_sup' (기대: $id 포함)."
				violations=$((violations + 1))
			fi
		fi
		done <<EOF
$supby_ids
EOF
	fi
done < "$adr_list"

if [ "$violations" -gt 0 ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

exit 0
