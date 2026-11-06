#!/bin/sh
# Assembles the publishable site into a directory: everything tracked under
# site/ except the full JSON shards, with a manifest that no longer advertises
# them.
#
#   sh tools/publish-dir.sh _site
#
# Used by the GitHub Actions deploy, which uploads a directory rather than
# pushing a branch. `tools/deploy.sh` makes the same selection with git
# plumbing for a local branch deploy. Why the shards are withheld:
# tools/publish-manifest.js.
#
# The file list comes from git, not from the filesystem, for one specific
# reason: site/data/books.db is 729 MB and gitignored. A plain copy of site/
# picks it up and produces an 836 MB "site" — the database is meant to be in
# R2, not published beside the page. Taking the list from the index means this
# publishes exactly what a branch deploy would.
set -eu

cd "$(dirname "$0")/.."
DEST=${1:?usage: publish-dir.sh DEST}

rm -rf "$DEST"
mkdir -p "$DEST"

git ls-files -z site/ \
  | grep -zv '\.full\.[0-9]*\.json$' \
  | while IFS= read -r -d '' f; do
      rel=${f#site/}
      mkdir -p "$DEST/$(dirname "$rel")"
      cp -p "$f" "$DEST/$rel"
    done

node tools/publish-manifest.js > "$DEST/data/manifest.json"

# Jekyll would otherwise ignore files beginning with an underscore.
touch "$DEST/.nojekyll"

n=$(find "$DEST" -type f | wc -l | tr -d ' ')
mb=$(du -sm "$DEST" | cut -f1)
echo "assembled $DEST — $n files, ${mb} MB"

# The published-site limit is 1 GB, and a deployment times out after 10
# minutes. Fail here rather than after a ten-minute wait, which is how the
# 6 Nov 2026 deploy failed.
if [ "$mb" -gt 700 ]; then
  echo "✗ ${mb} MB is too close to the 1 GB published-site limit to deploy safely." >&2
  exit 1
fi
