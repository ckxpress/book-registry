#!/bin/sh
# Uploads the built database to R2 under the object name the manifest expects.
#
#   npm run upload:db
#
# The dashboard cannot take this file: Cloudflare's GUI and `wrangler r2 object
# put` both cap out well below it ("Wrangler supports uploading files up to 315
# MB … For large files or bulk uploads, use rclone or another S3-compatible
# tool"). A Worker is worse, not better — a Worker in the path adds the Workers
# inbound request limit on top. So this goes over the S3-compatible API, where
# the single-part ceiling is 5 GiB and no multipart is needed.
#
# Credentials are never read from, or written to, this repository. Set them in
# your own shell, from R2 → Manage R2 API Tokens:
#
#   export R2_ACCOUNT_ID=…
#   export R2_ACCESS_KEY_ID=…
#   export R2_SECRET_ACCESS_KEY=…
#   export R2_BUCKET=…
#
# The object name is read out of the manifest rather than typed. That is the
# whole point of the script: the manifest advertises the database's exact byte
# length and page layout, and the startup probe only checks one row near the
# head of the file — so an object uploaded under the wrong name, or stale bytes
# under the right one, fails silently with wrong facet counts at the tail.
set -eu

cd "$(dirname "$0")/.."

DB=site/data/books.db
MANIFEST=site/data/manifest.json

[ -f "$DB" ] || { echo "✗ no $DB — run npm run build:db first" >&2; exit 1; }

eval "$(node -e '
  const m = require("./site/data/manifest.json").db;
  if (!m.url) throw new Error("manifest has no db.url — rebuild with --db-url https://db.jimbocho.app/");
  const key = m.url.split("/").pop();
  console.log("KEY=" + JSON.stringify(key));
  console.log("WANT_MD5=" + JSON.stringify(m.md5));
  console.log("WANT_BYTES=" + JSON.stringify(String(m.bytes)));
  console.log("URL=" + JSON.stringify(m.url));
')"

for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  eval "set +u; val=\${$v:-}; set -u"
  [ -n "$val" ] || { echo "✗ \$$v is not set — see the comments in $0" >&2; exit 1; }
done

command -v rclone >/dev/null 2>&1 || {
  echo "✗ rclone is not installed. brew install rclone" >&2; exit 1; }

# Refuse to upload a file the manifest does not describe. Catches the easy
# mistake of uploading after editing shards but before rebuilding.
HAVE_MD5=$(md5 -q "$DB" 2>/dev/null || md5sum "$DB" | cut -d' ' -f1)
HAVE_BYTES=$(wc -c < "$DB" | tr -d ' ')
if [ "$HAVE_MD5" != "$WANT_MD5" ] || [ "$HAVE_BYTES" != "$WANT_BYTES" ]; then
  echo "✗ $DB does not match the manifest — rebuild before uploading." >&2
  echo "    manifest  $WANT_MD5  $WANT_BYTES bytes" >&2
  echo "    on disk   $HAVE_MD5  $HAVE_BYTES bytes" >&2
  exit 1
fi

echo "→ $KEY  ($(echo "$HAVE_BYTES" | awk '{printf "%.1f MB", $1/1048576}'))"
echo "  md5 $HAVE_MD5 — R2 shows this as the object's etag"

RCLONE_CONFIG_R2_TYPE=s3 \
RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
RCLONE_CONFIG_R2_REGION=auto \
RCLONE_CONFIG_R2_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true \
  rclone copyto "$DB" "r2:$R2_BUCKET/$KEY" --progress --s3-upload-cutoff 5G

echo
echo "✓ uploaded. Now deploy the site so the manifest points at it:"
echo "    git push origin main && npm run deploy"
echo "  The live site keeps reading the old object until you do."
