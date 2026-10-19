// Live-search dropdown (wbblocksearch).
//
// The theme's JS does, from every page, at >= 3 characters:
//   $.post('/modules/wbblocksearch/controller_ajax_search.php',
//          {queryString: <text>, id_Cat: <id|'all'>},
//          d => $('#wbsearch_data').html(d))
// so this must answer a POST of form-encoded fields with an HTML FRAGMENT in
// the module's own markup. Without it the dropdown opens and stays blank.
//
// The URL carries no language, so it is taken from the Referer path.
// Results use the same query as /{lang}/search, so the "(N results have been
// found.)" count in the dropdown always agrees with the results page.
import { words, searchPage, esc } from '../../_catalogue.js';

const SHOWN = 8;   // the live module lists 8 and reports the true total

function item(p) {
  const url = esc(p.url || '#');
  const name = esc(p.name);
  const ref = esc(p.reference || '');
  const img = (p.id_image && p.link_rewrite)
    ? `/${p.id_image}-home_default/${esc(p.link_rewrite)}.jpg` : null;
  return `<li class="item">
            <div class="image float-xs-left">
                <a href="${url}" class="product_img_link" title="${name}">
                    ${img ? `<img src="${img}" alt="" />` : ''}
                </a>
            </div>
            <div class="wbContent text-xs-left">
                <h5 class="product-name">
                    <a class="product-name" href="${url}" title="${name}">${name}</a>
                </h5>
                ${ref ? `<h5 class="product-name">
                    <a class="product-name" href="${url}" title="${name}">${ref}</a>
                </h5>` : ''}
                <div class="content_price product-price-and-shipping"></div>
            </div>
        </li>`;
}

function fragment(iso, term, total, rows) {
  const head = iso === 'qc'
    ? `Resultat de la recherche pour  "${esc(term)}" <span>(${total}  resultat(s) trouve(s).)</span>`
    : `The result search for  "${esc(term)}" <span>(${total}  results have been found.)</span>`;
  const body = rows.length
    ? rows.map(item).join('\n')
    : `<p class="noresult">${iso === 'qc' ? 'Aucun article trouve !' : 'No found any item!'}</p>`;
  return `<div class="content-ajax-search">
<div class="search-title text-xs-left">
    ${head}
</div>
<ul class="items-list">
${body}
</ul>
</div>`;
}

async function handle(request, env) {
  const url = new URL(request.url);
  let term = '';
  let cat = 'all';
  if (request.method === 'POST') {
    const form = await request.formData();
    term = String(form.get('queryString') || '');
    cat = String(form.get('id_Cat') || 'all');
  } else {
    term = url.searchParams.get('queryString') || url.searchParams.get('s') || '';
    cat = url.searchParams.get('id_Cat') || 'all';
  }
  term = term.slice(0, 120);

  // No language in the URL - take it from the page that called us.
  let iso = 'en';
  try {
    const ref = request.headers.get('referer');
    if (ref && new URL(ref).pathname.startsWith('/qc')) iso = 'qc';
  } catch { /* no or unparsable referer: default en */ }

  const categoryId = /^\d+$/.test(cat) ? parseInt(cat, 10) : null;
  const terms = words(term);
  const { total, rows } = terms.length
    ? await searchPage(env, iso, terms, 1, { limit: SHOWN, categoryId })
    : { total: 0, rows: [] };

  return new Response(fragment(iso, term, total, rows), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=120',
    },
  });
}

export const onRequestPost = ({ request, env }) => handle(request, env);
export const onRequestGet = ({ request, env }) => handle(request, env);
