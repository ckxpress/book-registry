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
#
# Two things it does beyond that, both learned the hard way on 6 Nov 2026:
#
#  1. The full JSON shards are left out of the published tree. They are 369 MB
#     of the 462 MB site and a working site never fetches one — they exist for
#     the JSON fallback's detail view, and for the build and cover scripts,
#     which read them from the repository rather than over HTTP. Published in
#     full, the deploy exceeded the documented limit ("GitHub Pages deployments
#     will timeout if they take longer than 10 minutes") and failed at 10m14s.
#
#  2. It waits for GitHub to actually publish. Pushing to gh-pages only queues
#     a deployment; the old version keeps being served if that deployment
#     fails. This script used to print "✓ deployed" on a successful push, which
#     is why a failed publish went unnoticed for half an hour.
set -e

cd "$(dirname "$0")/.."

git fetch -q origin gh-pages

# Build the published tree in a scratch index, so the working tree is untouched.
INDEX=$(mktemp -t jimbocho-publish)
trap 'rm -f "$INDEX" "$INDEX.lock"' EXIT
export GIT_INDEX_FILE="$INDEX"

git read-tree "HEAD:site"

# Drop the full shards, and swap in a manifest that no longer advertises them
# so the app never requests a file that is not there.
FULL=$(git ls-files 'data/*.full.*.json')
if [ -n "$FULL" ]; then
  echo "$FULL" | tr '\n' '\0' | xargs -0 git update-index --force-remove --
fi
BLOB=$(unset GIT_INDEX_FILE; node tools/publish-manifest.js | git hash-object -w --stdin)
git update-index --add --cacheinfo "100644,$BLOB,data/manifest.json"

local_tree=$(git write-tree)
unset GIT_INDEX_FILE

published_mb=$(git ls-tree -r -l "$local_tree" | awk '{s+=$4} END {printf "%.0f", s/1048576}')
published_n=$(git ls-tree -r "$local_tree" | wc -l | tr -d ' ')
echo "publishing $published_n files, ${published_mb} MB (full shards withheld)"

remote_tree=$(git rev-parse "origin/gh-pages^{tree}")
if [ "$remote_tree" = "$local_tree" ]; then
  echo "✓ already deployed — nothing to push"
  exit 0
fi

commit=$(git commit-tree "$local_tree" -p "$(git rev-parse origin/gh-pages)" \
  -m "Deploy $(git rev-parse --short HEAD)")
git push origin "$commit:gh-pages"

echo
echo "pushed — waiting for GitHub Pages to publish…"

# If Pages is set to the "GitHub Actions" source, this push is inert: nothing
# builds from the branch and the site stays exactly as it was. Rather than wait
# fifteen minutes for a deployment that will never be created, say so.
PAGES_HINT="  Deploying from this branch may simply no longer be allowed. Two settings stop it,
  and both are side effects of moving publishing into Actions:
    Settings -> Pages -> Source           \"GitHub Actions\" ignores branch pushes entirely
    Settings -> Environments -> github-pages
                                          its deployment-branch rule names main, so
                                          gh-pages is refused
  If either is the case, deploy with the Deploy site workflow in the Actions tab.
  Do not add gh-pages back to that rule: two publishing paths that can disagree
  about what is live is worse than one."

REPO=$(git remote get-url origin | sed -e 's#^.*github\.com[:/]##' -e 's#\.git$##')
API="https://api.github.com/repos/$REPO/deployments?environment=github-pages&per_page=5"

# Match the deployment by the commit just pushed. Taking "the latest
# deployment" instead reads the *previous* one for the first few seconds, while
# GitHub has not yet created this one — which on 6 Nov reported a stale failure
# for a deploy that went on to succeed.
i=0
while [ "$i" -lt 60 ]; do
  sleep 15
  i=$((i + 1))
  state=$(curl -sS --max-time 20 "$API" 2>/dev/null | SHA="$commit" node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", async () => {
      try {
        const dep = JSON.parse(s).find((d) => d.sha === process.env.SHA);
        if (!dep) return console.log("pending");
        const res = await fetch(dep.statuses_url, { headers: { "user-agent": "jimbocho-deploy" } });
        const st = (await res.json())[0];
        console.log(st ? st.state : "pending");
      } catch { console.log("unknown"); }
    });
  ' 2>/dev/null)

  case "$state" in
    success)
      echo "✓ published $(git rev-parse --short HEAD) — live at https://jimbocho.app"
      exit 0 ;;
    failure|error)
      echo "✗ GitHub Pages deployment $state for $commit — the site still serves the previous build." >&2
      # Refused rather than attempted: a deployment that never reaches
      # in_progress was rejected up front. A genuine build failure takes
      # minutes and passes through queued and in_progress first.
      if [ "$i" -le 3 ]; then
        echo "  It failed within $((i * 15))s, before building, so it was refused rather than" >&2
        echo "  attempted." >&2
        echo "$PAGES_HINT" >&2
      fi
      echo "  https://github.com/$REPO/deployments" >&2
      exit 1 ;;
    pending)
      printf '  waiting for a deployment of %s (%ds)\r' "$(echo "$commit" | cut -c1-8)" "$((i * 15))"
      if [ "$i" = "8" ]; then
        echo
        echo "$PAGES_HINT" >&2
      fi ;;
    *)
      printf '  %s (%ds)\r' "$state" "$((i * 15))" ;;
  esac
done

echo "✗ no deployment appeared for $commit after 15 minutes." >&2
echo "$PAGES_HINT" >&2
exit 1
