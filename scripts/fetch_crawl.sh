#!/usr/bin/env bash
# Clone or update a shallow crawl checkout (with submodules) in DIR.
#
#   fetch_crawl.sh DIR
#
# Env: SDC_CRAWL_REF   commit, branch or tag to check out (default master's
#                      head). Builds that should share saves must use the
#                      same commit, so release builds pin it.
set -euo pipefail

CRAWL="${1:?usage: fetch_crawl.sh DIR}"
REF="${SDC_CRAWL_REF:-master}"
URL=https://github.com/crawl/crawl.git

if [ ! -d "$CRAWL/.git" ]; then
  mkdir -p "$CRAWL"
  git -C "$CRAWL" init -q
  git -C "$CRAWL" remote add origin "$URL"
else
  # drop local edits (patches, the patched client); they are re-applied
  git -C "$CRAWL" checkout -q -- . 2>/dev/null || true
fi
git -C "$CRAWL" fetch -q --depth 1 origin "$REF"
git -C "$CRAWL" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD
git -C "$CRAWL" submodule update -q --init --recursive --depth 1

# The shallow clone has no tags, but the build needs `git describe` to work.
# Tag HEAD locally with the latest upstream version tag.
latest="$(git -C "$CRAWL" ls-remote --tags origin \
  | grep -oE 'refs/tags/0\.[0-9]+[^{^]*$' | sed 's,refs/tags/,,' | sort -V | tail -1 || true)"
git -C "$CRAWL" -c user.name=local -c user.email=local@localhost \
  tag -f -a "${latest:-0.0-local}" -m local HEAD >/dev/null
echo "crawl $(git -C "$CRAWL" rev-parse --short HEAD) (${latest:-0.0-local}) in $CRAWL"
