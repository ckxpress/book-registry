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

# macOS has `md5 -q`, Linux has `md5sum`. This runs in both places — on a
# developer's Mac and on an Ubuntu CI runner — so neither name is assumed.
md5_of() {
  if command -v md5 >/dev/null 2>&1; then md5 -q "$@"
  else md5sum "$@" | cut -d' ' -f1
  fi
}
md5_stdin() {
  if command -v md5 >/dev/null 2>&1; then md5 -q
  else md5sum | cut -d' ' -f1
  fi
}

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
HAVE_MD5=$(md5_of "$DB")
HAVE_BYTES=$(wc -c < "$DB" | tr -d ' ')
if [ "$HAVE_MD5" != "$WANT_MD5" ] || [ "$HAVE_BYTES" != "$WANT_BYTES" ]; then
  echo "✗ $DB does not match the manifest — rebuild before uploading." >&2
  echo "    manifest  $WANT_MD5  $WANT_BYTES bytes" >&2
  echo "    on disk   $HAVE_MD5  $HAVE_BYTES bytes" >&2
  exit 1
fi

echo "→ $KEY  ($(echo "$HAVE_BYTES" | awk '{printf "%.1f MB", $1/1048576}'))"
echo "  md5 $HAVE_MD5"

# Exported, not prefixed onto one command: the verification below shells out
# to rclone a second time, and a prefix would leave that call with no
# credentials at all — which is exactly how it first reported a remote size of
# "?" for an object that was sitting there correctly.
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_REGION=auto
export RCLONE_CONFIG_R2_ENDPOINT="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true

rclone copyto "$DB" "r2:$R2_BUCKET/$KEY" --progress

# Verify the object rather than trusting the transfer. Not by etag: rclone
# uploads this in parts, and a multipart etag is a hash *of the part hashes*
# with a "-146" style suffix, not the file's md5 — so it cannot be compared
# with anything local. Size is exact, and two ranges fetched back and compared
# against the file on disk catch a truncated or reordered upload, which is the
# failure that would otherwise show up as wrong facet counts weeks later.
echo
echo "verifying…"

# `rclone size --json` takes a single object and prints {count, bytes};
# `lsjson` wants a directory and its shape differs between versions.
REMOTE_BYTES=$(rclone size --json "r2:$R2_BUCKET/$KEY" 2>/dev/null | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    try { console.log(JSON.parse(s).bytes); } catch { console.log("?"); }
  })')
if [ "$REMOTE_BYTES" = "$WANT_BYTES" ]; then
  echo "  size   ✓ $REMOTE_BYTES bytes"
else
  echo "  size   ✗ remote $REMOTE_BYTES, expected $WANT_BYTES" >&2
  exit 1
fi

TAIL_AT=$((WANT_BYTES - 4096))
for range in "0-4095" "$TAIL_AT-$((WANT_BYTES - 1))"; do
  want=$(dd if="$DB" bs=4096 skip=$((${range%-*} / 4096)) count=1 2>/dev/null | md5_stdin)
  got=$(curl -sS -r "$range" --max-time 120 "$URL" 2>/dev/null | md5_stdin)
  if [ "$want" = "$got" ]; then
    echo "  bytes $range  ✓ match"
  else
    echo "  bytes $range  ✗ differ (local $want, served $got)" >&2
    echo "  The object is wrong, or $URL is not yet serving it. Do not deploy." >&2
    exit 1
  fi
done

echo
echo "✓ uploaded and verified. Now deploy the site so the manifest points at it:"
echo "    git push origin main && npm run deploy"
echo "  The live site keeps reading the old object until you do."
