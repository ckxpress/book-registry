#!/bin/sh
# Deletes superseded database objects from R2, keeping the live one and a
# rollback.
#
#   sh tools/prune-r2.sh            # list what it would delete, delete nothing
#   sh tools/prune-r2.sh --confirm  # actually delete
#
# Why this is needed: the object name carries the database's content hash, so
# every rebuild writes a new object and the old one lingers. They are not
# interchangeable either — sqlite packs pages slightly differently between
# versions, so a CI rebuild and a laptop rebuild of identical data produce
# different hashes and therefore different objects. Left alone, roughly 450 MB
# accumulates per rebuild.
#
# What it will not do: delete the object the committed manifest names, delete
# anything if it cannot work out which object that is, or delete anything
# without --confirm. The newest survivor is kept as a rollback, because the
# point of hashed names is that the live site keeps reading the old object
# until the new one is proven.
#
# Credentials come from the environment, as in tools/upload-db.sh.
set -eu

cd "$(dirname "$0")/.."

KEEP=${KEEP:-2}          # the live object plus this many older ones, minus one
CONFIRM=${1:-}

for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  eval "set +u; val=\${$v:-}; set -u"
  [ -n "$val" ] || { echo "✗ $v is not set (an environment variable, or a repository secret of that exact name — no \"\$\")" >&2; exit 1; }
done
command -v rclone >/dev/null 2>&1 || { echo "✗ rclone is not installed" >&2; exit 1; }

LIVE=$(node -e '
  const m = require("./site/data/manifest.json").db;
  process.stdout.write(m && m.url ? m.url.split("/").pop() : "");
')
if [ -z "$LIVE" ]; then
  echo "✗ the manifest names no database object — refusing to delete anything." >&2
  exit 1
fi
echo "live object: $LIVE  (from site/data/manifest.json)"

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_REGION=auto
export RCLONE_CONFIG_R2_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"

# Newest first, so the survivors are the live object and the most recent others.
DOOMED=$(rclone lsjson "r2:$R2_BUCKET" 2>/dev/null | LIVE="$LIVE" KEEP="$KEEP" node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let rows;
    try { rows = JSON.parse(s); } catch { process.exit(3); }
    const live = process.env.LIVE;
    const keep = Math.max(1, Number(process.env.KEEP) || 2);

    // Only the per-rebuild database objects. Anything else in the bucket is
    // left alone.
    const dbs = rows
      .filter((r) => !r.IsDir && /^books.*\.db$/.test(r.Name))
      .sort((a, b) => String(b.ModTime).localeCompare(String(a.ModTime)));

    if (!dbs.some((r) => r.Name === live)) process.exit(4); // live object missing

    const survivors = new Set([live]);
    for (const r of dbs) {
      if (survivors.size >= keep) break;
      survivors.add(r.Name);
    }
    for (const r of dbs) if (!survivors.has(r.Name)) console.log(r.Name + "\t" + r.Size);
  });
') || {
  code=$?
  [ "$code" = "4" ] && echo "✗ $LIVE is not in the bucket — nothing deleted." >&2
  [ "$code" = "3" ] && echo "✗ could not read the bucket listing — nothing deleted." >&2
  exit 1
}

if [ -z "$DOOMED" ]; then
  echo "nothing to prune — keeping $KEEP, and there are no more."
  exit 0
fi

echo "$DOOMED" | awk -F'\t' '{ printf "  %-24s %7.1f MB\n", $1, $2/1048576 }'
total=$(echo "$DOOMED" | awk -F'\t' '{ s += $2 } END { printf "%.1f", s/1048576 }')

if [ "$CONFIRM" != "--confirm" ]; then
  echo
  echo "would free ${total} MB. Nothing deleted — re-run with --confirm."
  exit 0
fi

echo "$DOOMED" | cut -f1 | while IFS= read -r name; do
  [ -n "$name" ] || continue
  [ "$name" = "$LIVE" ] && { echo "  refusing to delete the live object" >&2; continue; }
  rclone deletefile "r2:$R2_BUCKET/$name"
  echo "  deleted $name"
done

echo "✓ freed ${total} MB, kept $LIVE and $((KEEP - 1)) older"
