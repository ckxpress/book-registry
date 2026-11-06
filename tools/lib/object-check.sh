# Shared by tools/upload-db.sh and tools/publish-dir.sh.
#
#   check_object URL EXPECTED_BYTES  ->  prints ok | stale-cache | wrong | missing
#
# Why this is not a one-liner. The database sits behind a Cloudflare Cache Rule
# with a long edge TTL, and that rule caches *negative* answers too. Probing an
# object name before it is uploaded — which is exactly what diagnosing a failed
# upload involves — leaves a 404 at the edge that outlives the upload. On
# 6 Nov 2026 a correct 435 MiB upload was reported as corrupt because the check
# hashed the body of a cached 404 page and compared it with the database.
#
# So: compare the length the response reports rather than hashing bytes blind,
# and tell "the object is wrong" apart from "the edge is still serving an old
# 404 for it". Those need opposite responses — rebuild versus purge.

_content_range_total() {
  curl -sS -r 0-4095 -D - -o /dev/null --max-time 60 "$1" 2>/dev/null \
    | tr -d '\r' \
    | sed -n 's@^[Cc]ontent-[Rr]ange:.*/@@p'
}

check_object() {
  _url=$1
  _want=$2

  if [ "$(_content_range_total "$_url")" = "$_want" ]; then
    echo ok
    return
  fi

  # The same object, fetched past the cache. A query string is enough: the
  # Cache Rule keys on the whole URL.
  _bust=$(date +%Y%m%d%H%M%S)
  _fresh=$(_content_range_total "${_url}?cachebust=${_bust}")
  if [ "$_fresh" = "$_want" ]; then
    echo stale-cache
  elif [ -n "$_fresh" ]; then
    echo wrong
  else
    echo missing
  fi
}

# One place to say what each verdict means, so both callers say the same thing.
explain_object() {
  case $1 in
    stale-cache)
      echo "  The object is correct, but the edge is still serving an older 404 for that" >&2
      echo "  name. Probing a name before uploading it leaves one behind, and the Cache" >&2
      echo "  Rule holds it for as long as its TTL. Purge it in Cloudflare — Caching ->" >&2
      echo "  Configuration -> Purge by URL — and run this again:" >&2
      echo "    $2" >&2
      ;;
    wrong)
      echo "  That name is serving a different file. Rebuild, or publish under a new" >&2
      echo "  object name." >&2
      ;;
    missing)
      echo "  Nothing is served at $2 — upload the database first (npm run upload:db)." >&2
      ;;
  esac
}
