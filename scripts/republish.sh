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
# categories, CMS and the two language roots come straight out of the database
$MYSQL "$DB" -N -B -e "
  SELECT CONCAT('http://$HOST/', l.iso_code, '/', c.id_category, '-', cl.link_rewrite)
  FROM ps_category c
  JOIN ps_category_lang cl ON cl.id_category=c.id_category
  JOIN ps_lang l ON l.id_lang=cl.id_lang
  WHERE c.active=1 AND c.id_category>1
  UNION ALL
  SELECT CONCAT('http://$HOST/', l.iso_code, '/content/', m.id_cms, '-', ml.link_rewrite)
  FROM ps_cms m JOIN ps_cms_lang ml ON ml.id_cms=m.id_cms
  JOIN ps_lang l ON l.id_lang=ml.id_lang WHERE m.active=1
  UNION ALL
  SELECT CONCAT('http://$HOST/', iso_code, '/') FROM ps_lang WHERE active=1" >> pages.txt
sort -u -o pages.txt pages.txt
echo "   total pages to crawl: $(wc -l < pages.txt)"

echo "== crawl =="
rm -rf "$OUT"; mkdir -p "$OUT"
OUT="$OUT" HOSTNAME_="$HOST" bash scripts/crawl.sh "$OUT" "$HOST" pages.txt

echo "== normalise, then refuse to publish a broken export =="
python3 scripts/normalise.py "$OUT" "$HOST"
python3 scripts/check-refs.py "$OUT" "$HOST" --known scripts/known-broken.txt || {
  echo "::error::export failed its reference check - NOT deploying"; exit 1; }

echo "== rebuild the D1 catalogue =="
python3 scripts/build-d1.py "$DB" canon.tsv d1.sql
npx --yes wrangler@4 d1 execute mlicanada-db --remote --file=d1.sql

echo "== deploy =="
cp -r functions "$OUT/../functions" 2>/dev/null || true
cp scripts/_redirects "$OUT/_redirects"
npx --yes wrangler@4 pages deploy "$OUT" --project-name "$PROJECT" --branch main

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
  --max-pages 700 --max-refs 1800
