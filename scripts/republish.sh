#!/bin/bash
# Rebuild the static site and the D1 catalogue from the PrestaShop running in
# THIS runner, then deploy to Cloudflare Pages.
#
# The crawl must see mlicanada.com URLs, not the tunnel hostname, or every
# <link rel="canonical"> in the export would point at a dead trycloudflare
# address. So the shop domain is set back to mlicanada.com and the crawl
# reaches Apache through /etc/hosts.
set -uo pipefail

MYSQL="mysql -h 127.0.0.1 -u root -pshoproot"
DB=jinwu_shop
HOST=mlicanada.com
OUT="$PWD/export"
PROJECT=mlicanada-holding

echo "== put the shop back on its real domain =="
$MYSQL "$DB" -e "
  UPDATE ps_shop_url SET domain='$HOST', domain_ssl='$HOST', physical_uri='/';
  UPDATE ps_configuration SET value='$HOST' WHERE name IN ('PS_SHOP_DOMAIN','PS_SHOP_DOMAIN_SSL');
  UPDATE ps_configuration SET value='0' WHERE name IN ('PS_SSL_ENABLED','PS_SSL_ENABLED_EVERYWHERE');"
docker exec ps sh -c 'rm -rf /var/www/html/var/cache/*' || true
grep -q " $HOST\$" /etc/hosts || echo "127.0.0.1 $HOST" | sudo tee -a /etc/hosts >/dev/null
sleep 5
code=$(curl -s -o /dev/null -w '%{http_code}' "http://$HOST/en/" || true)
echo "   http://$HOST/en/ -> $code"
if [ "$code" != "200" ]; then echo "shop is not answering on its own domain; aborting"; exit 1; fi

echo "== canonical URL for every ACTIVE product, from the shop itself =="
# Only active ids: an inactive product 404s, exactly as on the live site.
$MYSQL "$DB" -N -B -e "SELECT id_product FROM ps_product WHERE active=1 ORDER BY id_product" > ids.txt
echo "   active products: $(wc -l < ids.txt)"
python3 scripts/canon.py ids.txt canon.tsv 6 "http://$HOST"

echo "== page list =="
python3 - <<'PY'
import re
pages = set()
for line in open('canon.tsv', encoding='utf-8'):
    p = line.rstrip('\n').split('\t')
    if len(p) >= 4 and p[3].endswith('.html') and 'controller=404' not in p[3]:
        pages.add(p[3])
open('pages.txt', 'w', newline='\n').write('\n'.join(sorted(pages)) + '\n')
print('   product pages:', len(pages))
PY
# Categories, CMS pages and the two language roots come straight out of the
# database - as THREE separate queries, not one UNION. ps_category_lang and
# ps_cms_lang do not share a collation, so the UNION died with
#   ERROR 1271: Illegal mix of collations for operation 'UNION'
# and because mysql's non-zero exit was never checked, pages.txt silently kept
# only the 518 product pages: no categories, no CMS, not even /en/ or /qc/.
# The crawl then "succeeded" with a third of the site missing.
before=$(wc -l < pages.txt)
$MYSQL "$DB" -N -B -e "
  SELECT CONCAT('http://$HOST/', l.iso_code, '/', c.id_category, '-', cl.link_rewrite)
  FROM ps_category c
  JOIN ps_category_lang cl ON cl.id_category=c.id_category
  JOIN ps_lang l ON l.id_lang=cl.id_lang
  WHERE c.active=1 AND c.id_category>1" >> pages.txt   || { echo "::error::category URL query failed"; exit 1; }
cats=$(( $(wc -l < pages.txt) - before )); before=$(wc -l < pages.txt)
$MYSQL "$DB" -N -B -e "
  SELECT CONCAT('http://$HOST/', l.iso_code, '/content/', m.id_cms, '-', ml.link_rewrite)
  FROM ps_cms m JOIN ps_cms_lang ml ON ml.id_cms=m.id_cms
  JOIN ps_lang l ON l.id_lang=ml.id_lang WHERE m.active=1" >> pages.txt   || { echo "::error::CMS URL query failed"; exit 1; }
cms=$(( $(wc -l < pages.txt) - before )); before=$(wc -l < pages.txt)
$MYSQL "$DB" -N -B -e "
  SELECT CONCAT('http://$HOST/', iso_code, '/') FROM ps_lang WHERE active=1" >> pages.txt   || { echo "::error::language root query failed"; exit 1; }
roots=$(( $(wc -l < pages.txt) - before ))
echo "   categories: $cats   cms: $cms   language roots: $roots"
# None of these may be zero: each one was silently zero before this.
if [ "$cats" -eq 0 ] || [ "$cms" -eq 0 ] || [ "$roots" -eq 0 ]; then
  echo "::error::the page list is incomplete (categories=$cats cms=$cms roots=$roots)"
  exit 1
fi
sort -u -o pages.txt pages.txt
echo "   total pages to crawl: $(wc -l < pages.txt)"

echo "== crawl =="
rm -rf "$OUT"; mkdir -p "$OUT"
OUT="$OUT" HOSTNAME_="$HOST" bash scripts/crawl.sh "$OUT" "$HOST" pages.txt

echo "== normalise, then refuse to publish a broken export =="
python3 scripts/normalise.py "$OUT" "$HOST"
# --redirects: `/`, `/2-products` and the account paths are referenced by every
# page and are served by a _redirects rule, not a file. Without this the guard
# refuses a site that works - 6117 "missing" page refs across all 679 pages.
python3 scripts/check-refs.py "$OUT" "$HOST" --known scripts/known-broken.txt         --redirects scripts/_redirects || {
  echo "::error::export failed its reference check - NOT deploying"; exit 1; }

echo "== rebuild the D1 catalogue =="
# These were unchecked, and this script runs without -e: build-d1.py crashed
# on a cp1252 byte, d1.sql was never written, wrangler said "Unable to read
# SQL text file" - and the run still reported SUCCESS, having deployed the
# site against a stale catalogue. Gate both.
python3 scripts/build-d1.py "$DB" canon.tsv d1.sql \
  || { echo "::error::building the D1 catalogue failed"; exit 1; }
[ -s d1.sql ] || { echo "::error::d1.sql is empty or missing"; exit 1; }
echo "   d1.sql: $(wc -l < d1.sql) lines, $(du -h d1.sql | cut -f1)"
npx --yes wrangler@4 d1 execute mlicanada-db --remote --file=d1.sql \
  || { echo "::error::applying the D1 catalogue failed"; exit 1; }

echo "== deploy =="
cp -r functions "$OUT/../functions" 2>/dev/null || true
cp scripts/_redirects "$OUT/_redirects"
npx --yes wrangler@4 pages deploy "$OUT" --project-name "$PROJECT" --branch main \
  || { echo "::error::pages deploy failed"; exit 1; }

echo "== prove the FUNCTIONS deployed, not just the static pages =="
# Search and category pagination are served by Pages Functions reading D1, not
# by files on disk. A deploy that lost functions/ would still sail through the
# reference check above - every page and asset present - while /en/search and
# every ?page=2 went 404. So probe the Function routes directly.
fn_fail=0
sc=$(curl -s -o /dev/null -w '%{http_code}' "https://$PROJECT.pages.dev/en/search?q=a" || true)
echo "   /en/search?q=a -> $sc"
[ "$sc" = "200" ] || { echo "::error::/en/search is not served - the Pages Functions did not deploy"; fn_fail=1; }
cat_path=$(grep -oE "^http://$HOST/en/[0-9]+-[a-z0-9-]+$" pages.txt | head -1 | sed "s|http://$HOST||" || true)
if [ -n "$cat_path" ]; then
  pg=$(curl -s -o /dev/null -w '%{http_code}' "https://$PROJECT.pages.dev$cat_path?page=2" || true)
  echo "   $cat_path?page=2 -> $pg"
  [ "$pg" = "200" ] || { echo "::error::category pagination is not served"; fn_fail=1; }
else
  echo "::error::no category URL found in pages.txt to test pagination with"
  fn_fail=1
fi
# Control: a category id that cannot exist must NOT come back 200, or neither
# check above discriminates between a working site and a fallback page.
ctl=$(curl -s -o /dev/null -w '%{http_code}' "https://$PROJECT.pages.dev/en/999999-not-a-real-category" || true)
echo "   control /en/999999-not-a-real-category -> $ctl"
[ "$ctl" != "200" ] || { echo "::error::a nonexistent category returned 200 - these checks cannot discriminate"; fn_fail=1; }
[ "$fn_fail" = "0" ] || { echo "::error::Function routes are broken on the deployment"; exit 1; }

echo "== verify what we just published =="
(cd "$OUT" && find . -name '*.html' | sed 's|^\./||') > deployed-files.txt
python3 - deployed-files.txt > pages-deployed.txt <<'PY'
import sys
out = set()
for line in open(sys.argv[1], encoding='utf-8'):
    f = line.strip()
    if not f:
        continue
    b = f[:-5]
    out.add('/' + b.rsplit('/', 1)[0] + '/' if b.endswith('/index') or b == 'index' else '/' + b)
print('\n'.join(sorted(out)))
PY
python3 scripts/verify-live-refs.py "$HOST" --via "$PROJECT.pages.dev" \
  --paths pages-deployed.txt --known scripts/known-broken.txt \
  --max-pages 700 --max-refs 1800 \
  || { echo "::error::the DEPLOYED site failed verification"; exit 1; }

echo "== republish complete and verified =="
