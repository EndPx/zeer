#!/usr/bin/env bash
# Connected fixture smoke check, not a throughput benchmark or real-node reorg proof.
set -euo pipefail
cd "$(dirname "$0")/../.."
result="benchmarks/results/raw/quickstart-$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$result"
dc() { docker compose --env-file examples/quickstart/.env -f examples/quickstart/compose.yaml "$@"; }
config=examples/quickstart/chef.config.ts
trap 'dc stop api prep postgres fixture >"$result/stop.txt" 2>&1' EXIT
dc up -d --wait fixture postgres
dc run --rm ingest >"$result/ingest.jsonl" 2>"$result/ingest.stderr"
dc up -d prep
dc run --rm check --prep-only >"$result/prep-check.jsonl"
dc run --rm chef migrate --config "$config" >"$result/migrate.jsonl"
dc run --rm chef status --config "$config" >"$result/initial.jsonl"
# Fail early instead of continuing a supposedly fresh test on an old database.
dc run --rm --entrypoint node check -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(d.checkpoint.height!==null)throw Error("Use a new COMPOSE_PROJECT_NAME for fresh verification");' "$result/initial.jsonl"
dc run --rm chef sync --config "$config" --to 1687106 >"$result/first.jsonl"
dc up -d api
dc run --rm check 1687106 >"$result/first-check.jsonl"
dc stop api prep postgres
dc up -d --wait postgres
dc up -d prep api
dc run --rm check --prep-only >"$result/restarted-prep-check.jsonl"
dc run --rm chef sync --config "$config" --to 1687108 >"$result/resume.jsonl"
dc run --rm check 1687108 >"$result/resume-check.jsonl"
dc run --rm chef sync --config "$config" --to 1687108 >"$result/repeat.jsonl"
if dc run --rm chef sync --config "$config" --to 1687109 >"$result/outside-range.stdout" 2>"$result/outside-range.stderr"; then
  echo 'Unavailable range unexpectedly succeeded' >&2
  exit 1
fi
# Docker lifecycle messages are on stderr; retain them and extract the CLI record.
sed -n '/^{"error":/p' "$result/outside-range.stderr" >"$result/outside-range.jsonl"
dc run --rm check 1687108 >"$result/final-check.jsonl"
dc run --rm --entrypoint node check examples/quickstart/check-resume.mjs "$result" >"$result/resume-proof.jsonl"
dc ps -a >"$result/containers.txt"
echo "PASS: connected public fixture checks; local records in $result"
