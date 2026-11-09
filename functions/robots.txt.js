// robots.txt for mlicanada.com.
//
// Until 2026-11-09 this site had none of its own: the only robots.txt served
// was Cloudflare's managed one, whose `User-agent: *` group is just
// `Allow: /`. So every crawler was free to walk ?page=N forever, and on
// 2026-11-09 one of them did - 229,190 paginated category requests in a day,
// 2.9 BILLION D1 rows read, for a catalogue of 259 active products.
//
// Cloudflare still prepends its managed file on this zone, so the served
// result has two `User-agent: *` groups. That is expected and fine: a crawler
// combines the rules of every group that matches it, which is also how the
// nine xotours projects are set up and was verified there by parsing the
// groups rather than grepping the file.
//
// What is deliberately NOT here: the admin path. robots.txt is public, so
// listing it would advertise exactly the URL it is meant to keep quiet.
// Nothing links to it, and a Disallow line would be the only thing pointing
// a scanner at it.

const BODY = `User-agent: *
Allow: /

# Paginated category listings. Blocking these loses no indexable content:
# every active product has its own crawlable page and all 259 of them, plus
# all 61 categories, are listed in the sitemap below. What it does remove is
# the single largest source of waste on this site - each ?page=N request has
# to be rendered from the database, and the pages are identical between
# requests.
Disallow: /*?page=
Disallow: /*&page=

# Search is an unbounded query space: infinitely many URLs, no indexable
# value, and every one of them a database query.
Disallow: /en/search
Disallow: /qc/search
Disallow: /*?s=
Disallow: /*&s=
Disallow: /modules/wbblocksearch/

# Honoured by Bing and Yandex; Google ignores it and uses its own pacing.
Crawl-delay: 10

Sitemap: https://mlicanada.com/sitemap.xml
`;

export async function onRequestGet({ request }) {
  const host = new URL(request.url).hostname;
  // A *.pages.dev deployment is a staging copy of a live site: it must never
  // be indexed, or it competes with mlicanada.com for the same content.
  if (/(^|\.)pages\.dev$/i.test(host)) {
    return new Response('User-agent: *\nDisallow: /\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
  }
  return new Response(BODY, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}
