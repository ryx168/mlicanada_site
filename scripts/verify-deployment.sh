#!/bin/bash
# Verify a freshly deployed mlicanada-holding deployment.
#
# Usage: verify-deployment.sh <project> <multi-page-category-path> <shop-base-url>
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
SHOP="${3:-}"
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
    | grep -oiE 'href="(https?://[^"/]+)?/[a-z]{2}/[a-z0-9_-]+/[0-9]+-[^"]+[.]html"' \
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

# Completeness, against the SHOP ITSELF rather than the stated total.
# The total is the wrong yardstick: a product with no link_rewrite is
# rendered without a link, so it is unreachable on the origin too -
# /en/2-products shows 10 linked products out of 12 tiles. The real
# requirement is that the deployed site exposes exactly the products the
# shop exposes, so walk both and compare the sets.
#
# The page loop runs to 40, not 10: a 195-product category needs 17
# pages, and a cap of 10 made this check report 82 products "missing"
# that were simply never requested.
walk() {   # $1 = base URL for the category, writes a sorted path list
  local base="$1" out="$2" n
  plinks "$base" > "$out"
  for n in $(seq 2 40); do
    plinks "$base?page=$n" > pgn.txt
    [ -s pgn.txt ] || break
    cat pgn.txt >> "$out"
  done
  # Absolute shop URLs become root-relative so the two sides compare.
  sed -i -E "s|^https?://[^/]+||" "$out"
  sort -u -o "$out" "$out"
}

if [ -n "${SHOP:-}" ]; then
  walk "$SHOP$CAT" shop-all.txt
  walk "$BASE$CAT"  live-all.txt
  echo "   $CAT: the shop exposes $(wc -l < shop-all.txt) products, the deployment $(wc -l < live-all.txt)"
  if ! diff -q shop-all.txt live-all.txt >/dev/null; then
    echo "::error::the deployed category does not expose the same products as the shop"
    echo "      on the shop but NOT deployed:"; comm -23 shop-all.txt live-all.txt | head -8
    echo "      deployed but NOT on the shop:"; comm -13 shop-all.txt live-all.txt | head -8
    fail=1
  fi
else
  echo "::error::no shop base URL given, so category completeness is unchecked"
  fail=1
fi

[ "$fail" = "0" ] || exit 1
echo "   deployment verified: Functions live, no product on two pages, and the deployed categories expose exactly what the shop does"
