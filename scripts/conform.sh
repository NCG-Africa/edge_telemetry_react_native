#!/usr/bin/env bash
# Conformance (#179, stable goldens #189): check the raw batches the golden tests dump into test/raw
# (run `npm test` first) against the event catalogue at the tag pinned in catalogue.version, and
# their derived shape against test/shape.txt. Pass -update to rewrite the shape file after an
# intended wire change. Needs go and git. PROCESSOR_DIR reuses a local checkout.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
tag="$(cat "$root/catalogue.version")"
src="${PROCESSOR_DIR:-}"
if [ -z "$src" ]; then
  src="$(mktemp -d)"
  trap 'rm -rf "$src"' EXIT
  git -c advice.detachedHead=false clone -q --depth 1 --branch "$tag" https://github.com/NCG-Africa/edge_telemetry_processor_go.git "$src"
fi
cd "$src" && go run ./cmd/conform "$@" "$root/test/raw" "$root/test/shape.txt"
