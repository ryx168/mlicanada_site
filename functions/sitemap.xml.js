// sitemap.xml for mlicanada.com.
//
// WHY THIS EXISTS, and why it is not scope creep: robots.txt now blocks
// ?page=N, and paginated category listings were the ONLY way a crawler could
// reach a product that is not on page 1 of its category. Blocking them without
// this file would have quietly orphaned most of the catalogue - fewer indexed
// pages, which is the opposite of what this site is for. The sitemap replaces
// pagination as the discovery path, and does it better: one request lists
// every indexable URL instead of a crawler walking hundreds of listings.
//
// It is small and completely enumerable: 259 active products x 2 languages
// plus 61 active categories x 2. Built from product_urls, which holds the
// canonical URL the shop itself issued for each active product during the
// export crawl, so these are the same addresses the static export serves.

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (/(^|\.)pages\.dev$/i.test(url.hostname)) {
    return new Response('not found', { status: 404 });
  }

  const cache = caches.default;
  const gen = env.CF_PAGES_COMMIT_SHA || env.CF_PAGES_BRANCH || 'v1';
  const cacheKey = new Request(`${url.origin}/sitemap.xml?_g=${encodeURIComponent(gen)}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const origin = 'https://mlicanada.com';
  const seen = new Set();
  const urls = [];
  const add = (loc) => {
    if (!loc || seen.has(loc)) return;
    seen.add(loc);
    urls.push(loc);
  };

  add(`${origin}/en/`);
  add(`${origin}/qc/`);

  try {
    // Categories: page 1 of each is a real exported file.
    // id_parent = 0 is PrestaShop's internal root category. It is marked
    // active and has a link_rewrite ("root" / "racine"), so it looks like a
    // real category in the data - but no page is exported for it and
    // /en/1-root answers 404. Measured: it was the ONLY bad entry in the first
    // 642-URL sitemap, and exactly one row has id_parent = 0, so this excludes
    // it without touching anything else.
    //
    // Categories with no active products are deliberately KEPT: their pages
    // exist and return 200, and this site's whole point is more indexed pages.
    const cats = await env.DB.prepare(
      `SELECT cl.iso, cl.id_category, cl.link_rewrite
         FROM categories_lang cl
         JOIN categories c ON c.id_category = cl.id_category AND c.active = 1
        WHERE cl.link_rewrite IS NOT NULL AND cl.link_rewrite <> ''
          AND c.id_parent <> 0
        ORDER BY cl.iso, cl.id_category`).all();
    for (const r of cats.results || []) {
      add(`${origin}/${r.iso}/${r.id_category}-${r.link_rewrite}`);
    }

    // Products: the shop's own canonical URL for each active product.
    const prods = await env.DB.prepare(
      'SELECT iso, url FROM product_urls ORDER BY iso, id_product').all();
    for (const r of prods.results || []) {
      if (!r.url) continue;
      add(r.url.startsWith('http') ? r.url : origin + r.url);
    }
  } catch (e) {
    // A sitemap that silently drops half the catalogue is worse than an error
    // the monitoring can see, so fail loudly rather than serving a short file.
    return new Response('sitemap unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</loc></url>`).join('\n')
    + '\n</urlset>\n';

  const res = new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=86400',
      'x-url-count': String(urls.length),
    },
  });
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
