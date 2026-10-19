// /{lang}/search?s=...  - no static page exists for this path, so the shell is
// borrowed from the exported root-category page and only the listing swapped.
import {
  PER_PAGE, words, searchPage, tile, pagination, injectListing, setTitle,
  emptyMessage, esc,
} from '../_catalogue.js';

const SHELL = { en: '/en/2-products', qc: '/qc/2-accueil' };

export async function onRequestGet({ request, env, params }) {
  const lang = params.lang === 'qc' ? 'qc' : 'en';
  const url = new URL(request.url);
  const term = (url.searchParams.get('s') || url.searchParams.get('q') || '').slice(0, 120);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);

  const shellRes = await env.ASSETS.fetch(new Request(new URL(SHELL[lang], url), request));
  if (!shellRes.ok) return shellRes;
  let html = await shellRes.text();

  const terms = words(term);
  const { total, rows } = terms.length
    ? await searchPage(env, lang, terms, page)
    : { total: 0, rows: [] };
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const heading = lang === 'qc'
    ? (term ? `Recherche : ${esc(term)}` : 'Recherche')
    : (term ? `Search: ${esc(term)}` : 'Search');
  const count = total
    ? (lang === 'qc'
        ? `<p class="hidden-sm-down">${(page - 1) * PER_PAGE + 1}-${Math.min(page * PER_PAGE, total)} sur ${total} produit(s)</p>`
        : `<p class="hidden-sm-down">Showing ${(page - 1) * PER_PAGE + 1}-${Math.min(page * PER_PAGE, total)} of ${total} item(s)</p>`)
    : '';

  const inner = rows.length
    ? `<h2 class="h2">${heading}</h2>${count}
<div class="products product-thumbs row wb-product-grid">${rows.map(tile).join('\n')}</div>
${pagination(`/${lang}/search`, { s: term }, page, pages)}`
    : `<h2 class="h2">${heading}</h2>${term ? emptyMessage(lang, term) : ''}`;

  const out = injectListing(html, inner);
  if (out === null) return shellRes;      // markers missing: never serve a mangled page
  return new Response(setTitle(out, heading + ' - MLI Canada'), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-robots-tag': 'noindex, follow',
    },
  });
}
