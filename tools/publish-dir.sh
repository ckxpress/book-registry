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

# Plain newline-delimited, not `git ls-files -z` with `read -r -d ''`: /bin/sh
# is bash in POSIX mode on macOS, where `read -d` works, and dash on Ubuntu,
# where it does not. The CI run failed with "read: Illegal option -d" after
# this had passed on a laptop.
#
# Without -z, git quotes any path needing it, so refuse rather than silently
# mishandle one. No path under site/ has ever needed quoting.
if git ls-files site/ | grep -q '^"'; then
  echo "✗ a tracked path under site/ needs quoting; this script cannot handle it:" >&2
  git ls-files site/ | grep '^"' | sed 's/^/    /' >&2
  exit 1
fi

git ls-files site/ \
  | grep -v '\.full\.[0-9]*\.json$' \
  | while IFS= read -r f; do
      rel=${f#site/}
      mkdir -p "$DEST/$(dirname "$rel")"
      cp -p "$f" "$DEST/$rel"
    done

# If the copy produced nothing the next line fails with "Directory nonexistent",
# which says nothing useful about why.
[ -d "$DEST/data" ] || {
  echo "✗ nothing was copied into $DEST — is this a git checkout of the project?" >&2
  exit 1
}

node tools/publish-manifest.js > "$DEST/data/manifest.json"

# Jekyll would otherwise ignore files beginning with an underscore.
touch "$DEST/.nojekyll"

# Refuse to publish a site whose database is not actually being served.
#
# The manifest advertises that object's exact byte length, and the startup
# probe only reads one row near the head of the file — so a site published
# ahead of its database does not fail loudly, it fails at the facet tables in
# the tail, weeks later. Ordering the build steps is not enough: a CI rebuild
# committed a manifest and then failed to upload, leaving main one deploy away
# from advertising an object that returned 404.
. "$(dirname "$0")/lib/object-check.sh"

DB_URL=$(node -e 'const m = require("./site/data/manifest.json").db; process.stdout.write(m && m.url ? m.url : "");')
DB_BYTES=$(node -e 'const m = require("./site/data/manifest.json").db; process.stdout.write(m && m.url ? String(m.bytes) : "");')

if [ -n "$DB_URL" ]; then
  verdict=$(check_object "$DB_URL" "$DB_BYTES")
  if [ "$verdict" = "ok" ]; then
    echo "database ✓ $DB_URL serves $DB_BYTES bytes"
  else
    echo "✗ not publishing: $DB_URL is $verdict" >&2
    explain_object "$verdict" "$DB_URL"
    exit 1
  fi
fi

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
