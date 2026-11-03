#!/bin/sh
# Publishes site/ to the gh-pages branch, which is what GitHub Pages serves.
#
# `main` holds the source; gh-pages holds only the contents of site/ at its
# root, because branch-based Pages can serve from the root or /docs and
# nothing else.
#
# This builds a commit whose tree *is* site/ and parents it on the current
# remote tip. It does not use `git subtree push`: that keeps a parallel split
# history, and mixing the two makes every later push a non-fast-forward.
set -e

cd "$(dirname "$0")/.."

git fetch -q origin gh-pages

remote_tree=$(git rev-parse origin/gh-pages^{tree})
local_tree=$(git rev-parse HEAD:site)

if [ "$remote_tree" = "$local_tree" ]; then
  echo "✓ already deployed — site/ matches gh-pages, nothing to push"
  exit 0
fi

commit=$(git commit-tree "$local_tree" -p "$(git rev-parse origin/gh-pages)" \
  -m "Deploy $(git rev-parse --short HEAD)")
git push origin "$commit:gh-pages"

echo
echo "✓ deployed $(git rev-parse --short HEAD) — GitHub Pages rebuilds in about a minute"
