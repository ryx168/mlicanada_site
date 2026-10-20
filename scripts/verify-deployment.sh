#!/bin/bash
# Verify a freshly deployed mlicanada-holding deployment.
#
# Usage: verify-deployment.sh <project> <multi-page-category-path>
#
# Two things here that a page-and-asset check cannot see:
#
#  * Pages Functions. Search and ?page=N are served by Functions over D1, not
#    by files, so a deploy that lost functions/ passes every reference check
#    while those routes 404.
#  * The page-1/page-2 seam. Page 1 of a category is a CRAWLED PrestaShop
#    file; page 2 onwards comes from the Function. If the two order products
#    differently the site silently repeats one product and drops another, and
#    every page still returns 200. That is exactly what ORDER BY cp.position
#    did: category 194's crawled page 1 ended with 5" Tart Shell, and page 2
#    repeated it while Oval Foil Pie Shell vanished from the site.
set -uo pipefail

PROJECT="$1"
CAT="${2:-}"
BASE="https://$PROJECT.pages.dev"
fail=0

# A brand-new deployment is not instantly live on the project alias: probing it
# milliseconds after "Deployment complete" returned 500 for every Function
# route, including the control. Wait for it to settle rather than sleeping
# blindly, and only then assert.
settle() {
  local url="$1" code=000
  for _ in $(seq 1 12); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || true)
    case "$code" in 5*|000) sleep 5 ;; *) echo "$code"; return 0 ;; esac
  done
  echo "$code"
}

plinks() {
  curl -s --max-time 30 "$1" \
    | grep -oiE 'href="/[a-z]{2}/[a-z0-9_-]+/[0-9]+-[^"]+[.]html"' \
    | sed 's/^href="//I; s/"$//' | sort -u
}

echo "   waiting for the deployment to answer..."
root=$(settle "$BASE/en/")
echo "   /en/ -> $root"
[ "$root" = "200" ] || { echo "::error::the deployment never served /en/ (last: $root)"; fail=1; }

sc=$(settle "$BASE/en/search?q=a")
echo "   /en/search?q=a -> $sc"
[ "$sc" = "200" ] || { echo "::error::/en/search is not served - the Pages Functions did not deploy"; fail=1; }

ctl=$(settle "$BASE/en/999999-not-a-real-category")
echo "   control /en/999999-not-a-real-category -> $ctl"
[ "$ctl" = "404" ] || { echo "::error::a nonexistent category returned $ctl, not 404 - the Function checks cannot discriminate"; fail=1; }

if [ -z "$CAT" ]; then
  echo "::error::no multi-page category given, so the page-1/page-2 seam is unchecked"
  exit 1
fi

pg=$(settle "$BASE$CAT?page=2")
echo "   $CAT?page=2 -> $pg"
[ "$pg" = "200" ] || { echo "::error::category pagination is not served"; fail=1; }

plinks "$BASE$CAT"        > pg1.txt
plinks "$BASE$CAT?page=1" > pg1f.txt
plinks "$BASE$CAT?page=2" > pg2.txt
echo "   $CAT: crawled page 1 has $(wc -l < pg1.txt) products, the Function's page 1 has $(wc -l < pg1f.txt), page 2 has $(wc -l < pg2.txt)"

if ! diff -q pg1.txt pg1f.txt >/dev/null; then
  echo "::error::the Function's page 1 does not match the CRAWLED page 1 - the two use different orderings, so products are repeated and dropped at the page boundary"
  echo "      only in the crawled page 1:"; comm -23 pg1.txt pg1f.txt | head -5
  echo "      only in the Function page 1:"; comm -13 pg1.txt pg1f.txt | head -5
  fail=1
fi

both=$(comm -12 pg1.txt pg2.txt | wc -l)
echo "   products on BOTH page 1 and page 2: $both (must be 0)"
if [ "$both" -ne 0 ]; then
  echo "::error::these products appear on both pages, so others are missing from the site entirely:"
  comm -12 pg1.txt pg2.txt | head -5
  fail=1
fi

# The strongest invariant available: every product the category claims must
# appear exactly once across its pages. The ?page=1 comparison above is weak
# on its own - Pages serves the static file for that path whatever the query
# string, so it can compare the crawled page with itself - but a product that
# is repeated at the seam necessarily means another is missing, and this
# catches that directly against the shop's own stated total.
total=$(curl -s --max-time 30 "$BASE$CAT" | grep -oiE 'There (are|is) [0-9]+ product'         | head -1 | grep -oE '[0-9]+' || true)
if [ -n "${total:-}" ]; then
  : > allpages.txt
  cat pg1.txt >> allpages.txt
  for n in 2 3 4 5 6 7 8 9 10; do
    plinks "$BASE$CAT?page=$n" > pgn.txt
    [ -s pgn.txt ] || break
    cat pgn.txt >> allpages.txt
  done
  sort -u -o allpages.txt allpages.txt
  seen=$(wc -l < allpages.txt)
  echo "   $CAT claims $total products; $seen distinct products are reachable across its pages"
  if [ "$seen" -ne "$total" ]; then
    echo "::error::$CAT lists $total products but only $seen are reachable - $(( total - seen )) are on no page at all"
    fail=1
  fi
else
  echo "::error::could not read the product total off $CAT, so completeness is unchecked"
  fail=1
fi

[ "$fail" = "0" ] || exit 1
echo "   deployment verified: Functions live, the page seam is consistent, and every product is reachable"
