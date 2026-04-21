#!/usr/bin/env bash
# check-memory-adr.sh
# memory/decisions/*/memory.md ADR 파일의 프론트매터 정합성 검사.
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

if [ ! -d "memory/decisions" ]; then
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

# 파일 목록 수집
mapfile -t adr_files < <(find memory/decisions -mindepth 2 -maxdepth 2 -name "memory.md" -type f | sort)

if [ "${#adr_files[@]}" -eq 0 ]; then
	exit 0
fi

declare -A id_to_file
declare -A id_to_supersedes
declare -A id_to_superseded_by
declare -A id_to_status

for file in "${adr_files[@]}"; do
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

	if [ -n "$id" ]; then
		id_to_file["$id"]="$file"
		id_to_supersedes["$id"]="$supersedes"
		id_to_superseded_by["$id"]="$superseded_by"
		id_to_status["$id"]="$status"
	fi
done

# 상호 링크 정합성
for id in "${!id_to_file[@]}"; do
	sup="${id_to_supersedes[$id]:-}"
	supby="${id_to_superseded_by[$id]:-}"
	file="${id_to_file[$id]}"

	if [ -n "$sup" ] && [ "$sup" != "null" ]; then
		target_file="${id_to_file[$sup]:-}"
		if [ -z "$target_file" ]; then
			echo "⚠️  ADR supersedes: $file — supersedes=$sup 를 찾을 수 없음."
			violations=$((violations + 1))
		else
			target_supby="${id_to_superseded_by[$sup]:-}"
			target_status="${id_to_status[$sup]:-}"
			if [ "$target_supby" != "$id" ]; then
				echo "⚠️  ADR 상호 링크: $file(id=$id) 가 $sup 을 supersede 하지만, $target_file 의 superseded_by 는 '$target_supby' (기대: $id)."
				violations=$((violations + 1))
			fi
			if [ "$target_status" != "Superseded" ]; then
				echo "⚠️  ADR 상호 링크: $target_file — 다른 ADR($id)에 의해 superseded 되었으므로 status 를 Superseded 로 갱신하세요 (현재: '$target_status')."
				violations=$((violations + 1))
			fi
		fi
	fi

	if [ -n "$supby" ] && [ "$supby" != "null" ]; then
		target_file="${id_to_file[$supby]:-}"
		if [ -z "$target_file" ]; then
			echo "⚠️  ADR superseded_by: $file — superseded_by=$supby 를 찾을 수 없음."
			violations=$((violations + 1))
		else
			target_sup="${id_to_supersedes[$supby]:-}"
			if [ "$target_sup" != "$id" ]; then
				echo "⚠️  ADR 상호 링크: $file(id=$id) 가 $supby 에 의해 superseded 되었다고 주장하지만, $target_file 의 supersedes 는 '$target_sup' (기대: $id)."
				violations=$((violations + 1))
			fi
		fi
	fi
done

if [ "$violations" -gt 0 ] && [ "$STRICT" = "1" ]; then
	exit 1
fi

exit 0
