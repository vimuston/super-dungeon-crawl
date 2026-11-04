#!/usr/bin/env bash
# Apply patches/*.patch to a crawl checkout, idempotently: a patch that is
# already in is skipped. Every build uses this, so all of them carry the same
# changes.
#
#   apply_patches.sh CRAWL_CHECKOUT
#
# A patch that no longer applies (upstream moved the code) stops the build.
# Env: SDC_ALLOW_PATCH_FAIL=1 skips such a patch with a warning instead (the
# binary then lacks that feature: e.g. no damage numbers).
set -euo pipefail

CRAWL="${1:?usage: apply_patches.sh CRAWL_CHECKOUT}"
PATCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/patches"

for p in "$PATCH_DIR"/*.patch; do
  [ -f "$p" ] || continue
  name="$(basename "$p")"
  if git -C "$CRAWL" apply -R --check "$p" 2>/dev/null; then
    echo "Patch already applied: $name"
  elif git -C "$CRAWL" apply --check "$p" 2>/dev/null; then
    git -C "$CRAWL" apply "$p"
    echo "Applied patch: $name"
  elif [ "${SDC_ALLOW_PATCH_FAIL:-0}" = 1 ]; then
    echo "WARNING: patch does not apply, skipping: $name" >&2
  else
    echo "ERROR: patch does not apply to this crawl version: $name" >&2
    echo "  (update it, pin an older crawl with SDC_CRAWL_REF, or set" >&2
    echo "  SDC_ALLOW_PATCH_FAIL=1 to build without it)" >&2
    exit 1
  fi
done
