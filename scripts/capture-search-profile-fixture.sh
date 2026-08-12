#!/usr/bin/env bash
# capture-search-profile-fixture.sh — regenerate tests/fixtures/search-profile-response.json (issue #2198).
#
# The bounded Search DSL validator accepts a `profile` boolean, and the result
# view and the ExplainViewer render whatever `profile` section the cluster returns. Before #2198 no
# struct, interface or fixture in this repository described that section, so the
# only samples were two hand-written stubs with a single key each. This script
# captures the real thing so the next person reads a recorded response instead
# of guessing at one.
#
# It starts throwaway single-node containers on ports that do not collide with
# the e2e smoke ports (19200 / 29200 in .github/workflows/e2e-smoke.yml), seeds
# two documents, runs one `profile: true` search per product, and rewrites the
# fixture. Requires docker, curl and python3. Containers are removed on exit.
#
# Timings, node ids and shard ids in the fixture are captured values and differ
# on every run — no test asserts them. What the fixture pins is the shape:
# `shards[].searches[].query[].breakdown` / `time_in_nanos` / `collector[]` and
# the per-product delta between the two clusters.
set -euo pipefail

ES_IMAGE="docker.elastic.co/elasticsearch/elasticsearch:8.12.2"
OS_IMAGE="opensearchproject/opensearch:2.13.0"
PASSWORD="TableViewSearch1!"
ES_PORT=19255
OS_PORT=29255
ES_CONTAINER=tv2198-es
OS_CONTAINER=tv2198-os

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
out="$repo_root/tests/fixtures/search-profile-response.json"
work="$(mktemp -d)"

cleanup() {
  docker rm -f "$ES_CONTAINER" "$OS_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

wait_for_cluster() {
  local auth="$1" port="$2" label="$3" attempt
  for attempt in $(seq 1 150); do
    if curl -fsS -u "$auth" \
      "http://localhost:${port}/_cluster/health?wait_for_status=yellow&timeout=1s" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "ABORT: $label did not become ready" >&2
  return 1
}

seed_and_capture() {
  local auth="$1" port="$2" index="$3" out_file="$4"
  local bulk="${out_file%.json}.ndjson"
  curl -fsS -u "$auth" -XPUT "http://localhost:${port}/${index}" \
    -H 'Content-Type: application/json' \
    -d '{"settings":{"number_of_shards":1,"number_of_replicas":0},
         "mappings":{"properties":{"@timestamp":{"type":"date"},
                                   "message":{"type":"text"},
                                   "status":{"type":"keyword"}}}}' >/dev/null

  # Written to a file rather than inlined: `_bulk` rejects a payload without a
  # trailing newline with HTTP 400, and `"$(cat <<EOF …)"` strips exactly that
  # newline. A heredoc redirected to a file keeps it.
  cat >"$bulk" <<EOF
{"index":{"_index":"${index}","_id":"doc-1"}}
{"@timestamp":"2026-05-24T00:00:00Z","message":"fixture log","status":"ok"}
{"index":{"_index":"${index}","_id":"doc-2"}}
{"@timestamp":"2026-05-24T00:01:00Z","message":"fixture error","status":"error"}
EOF

  curl -fsS -u "$auth" -XPOST "http://localhost:${port}/${index}/_bulk?refresh=true" \
    -H 'Content-Type: application/x-ndjson' --data-binary "@$bulk" \
    | python3 -c 'import json,sys; assert not json.load(sys.stdin)["errors"], "bulk seed failed"'

  curl -fsS -u "$auth" -XPOST "http://localhost:${port}/${index}/_search" \
    -H 'Content-Type: application/json' \
    -d '{"query":{"match":{"message":"fixture"}},
         "aggs":{"by_status":{"terms":{"field":"status"}}},
         "profile":true}' >"$out_file"

  # Recorded in the fixture as the reason the validator only accepts a boolean:
  # both clusters answer a non-boolean `profile` with HTTP 400.
  curl -sS -u "$auth" -XPOST "http://localhost:${port}/${index}/_search" \
    -H 'Content-Type: application/json' \
    -d '{"query":{"match_all":{}},"profile":{"deep":true}}' >"${out_file%.json}.reject.json"
}

docker rm -f "$ES_CONTAINER" "$OS_CONTAINER" >/dev/null 2>&1 || true

docker run -d --name "$ES_CONTAINER" --publish "${ES_PORT}:9200" \
  --env "discovery.type=single-node" \
  --env "ELASTIC_PASSWORD=${PASSWORD}" \
  --env "xpack.security.enabled=true" \
  --env "xpack.security.http.ssl.enabled=false" \
  --env "xpack.security.transport.ssl.enabled=false" \
  --env "ES_JAVA_OPTS=-Xms512m -Xmx512m" \
  "$ES_IMAGE" >/dev/null

docker run -d --name "$OS_CONTAINER" --publish "${OS_PORT}:9200" \
  --env "discovery.type=single-node" \
  --env "OPENSEARCH_INITIAL_ADMIN_PASSWORD=${PASSWORD}" \
  --env "plugins.security.ssl.http.enabled=false" \
  --env "OPENSEARCH_JAVA_OPTS=-Xms512m -Xmx512m" \
  --ulimit memlock=-1:-1 --ulimit nofile=65536:65536 \
  "$OS_IMAGE" >/dev/null

wait_for_cluster "elastic:${PASSWORD}" "$ES_PORT" elasticsearch
wait_for_cluster "admin:${PASSWORD}" "$OS_PORT" opensearch

# The index names mirror e2e/fixtures/seed-smoke.ts. They deliberately avoid the
# `logs-*` prefix: Elasticsearch ships a built-in `logs` index template that
# creates data streams only, and a plain index PUT under that prefix fails.
seed_and_capture "elastic:${PASSWORD}" "$ES_PORT" "table-view-elastic-2026.05.24" "$work/es.json"
seed_and_capture "admin:${PASSWORD}" "$OS_PORT" "table-view-opensearch-2026.05.24" "$work/os.json"

curl -fsS -u "elastic:${PASSWORD}" "http://localhost:${ES_PORT}/" >"$work/es-root.json"
curl -fsS -u "admin:${PASSWORD}" "http://localhost:${OS_PORT}/" >"$work/os-root.json"

python3 - "$work" "$out" "$ES_IMAGE" "$OS_IMAGE" <<'PY'
import json
import sys
from datetime import datetime, timezone

work, out, es_image, os_image = sys.argv[1:5]


def load(name):
    with open(f"{work}/{name}") as handle:
        return json.load(handle)


request_body = {
    "query": {"match": {"message": "fixture"}},
    "aggs": {"by_status": {"terms": {"field": "status"}}},
    "profile": True,
}

reject = load("es.reject.json")["error"]

document = {
    "schemaVersion": 1,
    "description": (
        "Real `_search` responses captured from local single-node containers after the "
        "bounded Search DSL validator started accepting the `profile` boolean (#2198). "
        "Only the `profile` section of each response is kept. Nothing here promotes runtime "
        "support: it is contract evidence for the payload shape the result view renders."
    ),
    "capture": {
        "command": "bash scripts/capture-search-profile-fixture.sh",
        "capturedOn": datetime.now(timezone.utc).date().isoformat(),
        "index": "table-view-<product>-2026.05.24",
        "seedDocuments": [
            {"_id": "doc-1", "@timestamp": "2026-05-24T00:00:00Z", "message": "fixture log", "status": "ok"},
            {"_id": "doc-2", "@timestamp": "2026-05-24T00:01:00Z", "message": "fixture error", "status": "error"},
        ],
        "requestBody": request_body,
    },
    "nonBooleanProfileIsRejectedByBothClusters": {
        "requestBody": {"query": {"match_all": {}}, "profile": {"deep": True}},
        "httpStatus": 400,
        "errorType": reject["type"],
        "reason": reject["reason"],
    },
    "captures": [
        {
            "product": "elasticsearch",
            "image": es_image,
            "version": load("es-root.json")["version"]["number"],
            "luceneVersion": load("es-root.json")["version"]["lucene_version"],
            "profile": load("es.json")["profile"],
        },
        {
            "product": "opensearch",
            "image": os_image,
            "version": load("os-root.json")["version"]["number"],
            "luceneVersion": load("os-root.json")["version"]["lucene_version"],
            "profile": load("os.json")["profile"],
        },
    ],
}

with open(out, "w") as handle:
    json.dump(document, handle, indent=2, ensure_ascii=False)
    handle.write("\n")
print(f"wrote {out}")
PY

# `json.dump(indent=2)` and biome disagree on short arrays, and biome runs over the
# whole tree in the pre-push hook — so the script has to leave a formatted file or
# every regeneration breaks the next push.
(cd "$repo_root" && pnpm exec biome format --write "$out")
