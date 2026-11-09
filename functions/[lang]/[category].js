// /{lang}/{id}-{slug}  - page 1 is a real exported file and is served
// untouched. Only a ?page=N request is rendered from D1, because static
// hosting ignores the query string and would otherwise serve page 1 again.
import {
  PER_PAGE, categoryPage, tile, pagination, injectListing,
} from '../_catalogue.js';

export async function onRequestGet(context) {
  const { request, env, params, next } = context;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const slug = String(params.category || '');
  const m = /^(\d+)-/.exec(slug);

  // Not a paginated category request -> let the static asset answer.
  if (!m || !(page > 1)) return next();

  const lang = params.lang === 'qc' ? 'qc' : 'en';
  const categoryId = parseInt(m[1], 10);

  // EDGE CACHE. There are only a few hundred distinct ?page=N URLs in this
  // catalogue (61 categories, ~4 pages each, 2 languages), but on 2026-11-09 a
  // single crawler requested them 229,190 times - roughly 600 rebuilds of each
  // identical page in one day. Nothing was cached, so each rebuild ran two D1
  // queries.
  //
  // Note the `cache-control: public, max-age=300` this handler already sent was
  // NOT doing this job: Cloudflare does not put a Pages Function response into
  // the edge cache on its own, so the header only ever reached the browser. The
  // Cache API call below is what actually stores it.
  const cache = caches.default;
  // Only lang, slug and page change the output. Normalising the key keeps a
  // tracking parameter (?page=2&fbclid=...) from splitting the cache into
  // unlimited distinct entries, which would defeat the whole thing.
  //
  // The deployment id is part of the key so a republish starts a fresh cache
  // generation instead of needing a purge - republish.sh rewrites D1 and
  // redeploys together, so a new deployment means new data.
  const gen = env.CF_PAGES_COMMIT_SHA || env.CF_PAGES_BRANCH || 'v1';
  const keyUrl = new URL(url.origin + url.pathname);
  keyUrl.searchParams.set('page', String(page));
  keyUrl.searchParams.set('_g', gen);
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  // The shell is this category's own exported page 1.
  const shellRes = await next();
  if (!shellRes.ok) return shellRes;
  let html = await shellRes.text();

  const { total, rows } = await categoryPage(env, lang, categoryId, page);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (page > pages || !rows.length) {
    // Beyond the last page: 404 rather than silently showing page 1.
    //
    // Cached like any other answer, and deliberately so: a crawler that has
    // decided ?page=99 exists will keep asking, and an uncached 404 costs the
    // same two D1 queries as a real page. The Cache API only stores a response
    // that says it may be stored, so the header is set explicitly here rather
    // than inherited from the shell.
    const miss = new Response(html, {
      status: 404,
      headers: {
        'content-type': shellRes.headers.get('content-type') || 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    });
    context.waitUntil(cache.put(cacheKey, miss.clone()));
    return miss;
  }

  const count = lang === 'qc'
    ? `<p class="hidden-sm-down">${(page - 1) * PER_PAGE + 1}-${Math.min(page * PER_PAGE, total)} sur ${total} produit(s)</p>`
    : `<p class="hidden-sm-down">Showing ${(page - 1) * PER_PAGE + 1}-${Math.min(page * PER_PAGE, total)} of ${total} item(s)</p>`;
  const inner = `${count}
<div class="products product-thumbs row wb-product-grid">${rows.map(tile).join('\n')}</div>
${pagination(`/${lang}/${slug}`, {}, page, pages)}`;

  const out = injectListing(html, inner);
  // Injection failed - the exported page 1 no longer has the block we patch.
  // Return the shell unchanged and do NOT cache it: that is a signal the
  // export has drifted, and caching it would hide the breakage for an hour.
  if (out === null) return shellRes;
  const res = new Response(out, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'link': `<${url.origin}/${lang}/${slug}>; rel="canonical"`,
    },
  });
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
