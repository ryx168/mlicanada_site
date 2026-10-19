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

  // The shell is this category's own exported page 1.
  const shellRes = await next();
  if (!shellRes.ok) return shellRes;
  let html = await shellRes.text();

  const { total, rows } = await categoryPage(env, lang, categoryId, page);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (page > pages || !rows.length) {
    // Beyond the last page: 404 rather than silently showing page 1.
    return new Response(html, { status: 404, headers: shellRes.headers });
  }

  const count = lang === 'qc'
    ? `<p class="hidden-sm-down">${(page - 1) * PER_PAGE + 1}-${Math.min(page * PER_PAGE, total)} sur ${total} produit(s)</p>`
    : `<p class="hidden-sm-down">Showing ${(page - 1) * PER_PAGE + 1}-${Math.min(page * PER_PAGE, total)} of ${total} item(s)</p>`;
  const inner = `${count}
<div class="products product-thumbs row wb-product-grid">${rows.map(tile).join('\n')}</div>
${pagination(`/${lang}/${slug}`, {}, page, pages)}`;

  const out = injectListing(html, inner);
  if (out === null) return shellRes;
  return new Response(out, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'link': `<${url.origin}/${lang}/${slug}>; rel="canonical"`,
    },
  });
}
