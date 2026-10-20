// Shared catalogue rendering for mlicanada.com.
//
// The static export carries every ACTIVE product page plus page 1 of each
// category. What static hosting cannot serve is a query string, so these
// Functions cover exactly the two cases that need one:
//   /{lang}/search?s=...        (no static page exists)
//   /{lang}/{id}-{slug}?page=N  (pages 2..n of a category)
//
// Both render into the real page's own `#js-product-list` block, so the header,
// footer, menus and CSS come from the exported HTML and cannot drift.

export const PER_PAGE = 12;

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Split a query into words, keeping it cheap and injection-free (values are
// always bound, never interpolated).
export function words(q) {
  return String(q || '').toLowerCase().split(/[^\p{L}\p{N}.\-/"']+/u)
    .map(w => w.trim()).filter(w => w.length >= 2).slice(0, 6);
}

const SELECT = `
  SELECT p.id_product, p.reference, p.id_image, l.name, l.link_rewrite, u.url`;
const FROM = `
  FROM products p
  JOIN products_lang l ON l.id_product = p.id_product AND l.iso = ?
  LEFT JOIN product_urls u ON u.id_product = p.id_product AND u.iso = ?`;

export async function categoryPage(env, iso, categoryId, page) {
  const off = (page - 1) * PER_PAGE;
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM category_product cp
       JOIN products p ON p.id_product = cp.id_product AND p.active = 1
      WHERE cp.id_category = ?`).bind(categoryId).first('n');
  // Ordered by REFERENCE, because that is what this shop is configured to do:
  // PS_PRODUCTS_ORDER_BY = 7, PS_PRODUCTS_ORDER_WAY = 0. Confirmed by reading
  // the origin's page 1 in document order (169 172 174 177 180 182 183 185
  // 190 197 198 237) and matching it against ORDER BY reference, name and
  // position in the origin's own database - only reference matches. It looks
  // alphabetical by name in this catalogue, but that is a coincidence of the
  // data, and ordering by name gets a different page 2.
  //
  // This matters because page 1 of a category is a CRAWLED PrestaShop file and
  // only ?page=2 onwards is served from here, so a different ordering on
  // either side of the boundary repeats one product and drops another while
  // every URL still returns 200. ORDER BY cp.position did exactly that:
  // category 194's page 2 repeated 5" Tart Shell and Oval Foil Pie Shell
  // appeared on no page at all. id_product is a unique final tiebreaker so the
  // LIMIT/OFFSET window is deterministic.
  const rows = await env.DB.prepare(
    `${SELECT} ${FROM}
       JOIN category_product cp ON cp.id_product = p.id_product AND cp.id_category = ?
      WHERE p.active = 1
      ORDER BY p.reference, p.id_product
      LIMIT ? OFFSET ?`).bind(iso, iso, categoryId, PER_PAGE, off).all();
  return { total: total || 0, rows: rows.results || [] };
}

// `haystack` holds name + reference + tags + descriptions + category names, and
// `title` holds just name + reference - so title's text is a PREFIX of
// haystack's and any title match is necessarily a haystack match. One WHERE on
// haystack therefore finds everything; title only decides the ordering, so that
// a name match outranks a product that merely sits in a matching category.
// Placeholders are sequential `?` bound in textual order.
export async function searchPage(env, iso, terms, page, opts = {}) {
  if (!terms.length) return { total: 0, rows: [] };
  const limit = opts.limit || PER_PAGE;
  const off = (page - 1) * limit;
  const cat = Number.isFinite(opts.categoryId) ? opts.categoryId : null;
  // Optional category restriction, used by the live-search dropdown's id_Cat.
  const catJoin = cat ? ' JOIN category_product cpf ON cpf.id_product = p.id_product AND cpf.id_category = ?' : '';
  const catCount = cat
    ? ' AND EXISTS (SELECT 1 FROM category_product cpf WHERE cpf.id_product = s.id_product AND cpf.id_category = ?)'
    : '';
  const like = terms.map(w => `%${w}%`);
  const hay = terms.map(() => 's.haystack LIKE ?').join(' AND ');
  const ttl = terms.map(() => 's.title LIKE ?').join(' AND ');
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM product_search s
      WHERE s.iso = ? AND s.active = 1 AND ${hay}${catCount}`)
    .bind(iso, ...like, ...(cat ? [cat] : [])).first('n');
  const rows = await env.DB.prepare(
    `${SELECT} ${FROM}
       JOIN product_search s ON s.id_product = p.id_product AND s.iso = ?${catJoin}
      WHERE s.active = 1 AND ${hay}
      ORDER BY CASE WHEN ${ttl} THEN 0 ELSE 1 END, l.name, p.id_product
      LIMIT ? OFFSET ?`)
    .bind(iso, iso, iso, ...(cat ? [cat] : []), ...like, ...like, limit, off).all();
  return { total: total || 0, rows: rows.results || [] };
}

export function tile(p) {
  const url = esc(p.url || '#');
  // A product with no link_rewrite builds the image path /<id>-home_default/.jpg,
  // which 404s on the live site too. Render no thumbnail rather than a broken one.
  const hasImg = p.id_image && p.link_rewrite;
  const small = hasImg ? `/${p.id_image}-home_default/${esc(p.link_rewrite)}.jpg` : null;
  const large = hasImg ? `/${p.id_image}-large_default/${esc(p.link_rewrite)}.jpg` : null;
  const name = esc(p.name);
  return `<div class="item-product col-xs-12 col-sm-6 col-md-12 col-lg-4">
  <article class="col-lg-3 col-md-12 col-sm-12 col-xs-12 pro-home product-miniature js-product-miniature" data-id-product="${p.id_product}" data-id-product-attribute="0" itemscope itemtype="http://schema.org/Product">
    <div class="thumbnail-container">
      <div class="wb-image-block">
      <a href="${url}" class="thumbnail product-thumbnail">${hasImg ? `
        <img class="center-block img-responsive" src="${small}" alt="${name}" data-full-size-image-url="${large}">` : ''}
      </a>
      </div>
      <div class="wb-product-desc">
        <div class="r-t-p">
          <h1 class="h2 product-head1" itemprop="code" style="text-align: left;"><a href="${url}">${esc(p.reference || '')}</a></h1>
          <h3 class="h3 product-title" itemprop="name" style="text-align: left;"><a href="${url}">${name}</a></h3>
          <div id="product-description-short-${p.id_product}" itemprop="description" class="listds"></div>
        </div>
      </div>
    </div>
  </article>
</div>`;
}

export function pagination(basePath, extra, page, pages) {
  if (pages <= 1) return '';
  const href = n => {
    const qs = new URLSearchParams(extra);
    if (n > 1) qs.set('page', String(n)); else qs.delete('page');
    const s = qs.toString();
    return esc(basePath + (s ? '?' + s : ''));
  };
  const li = [];
  if (page > 1) li.push(`<li><a rel="prev" href="${href(page - 1)}" class="previous js-search-link"><i class="material-icons">&#xE314;</i></a></li>`);
  const from = Math.max(1, page - 3), to = Math.min(pages, page + 3);
  for (let n = from; n <= to; n++) {
    li.push(n === page
      ? `<li class="current"><a rel="nofollow" href="${href(n)}" class="disabled js-search-link">${n}</a></li>`
      : `<li><a rel="nofollow" href="${href(n)}" class="js-search-link">${n}</a></li>`);
  }
  if (page < pages) li.push(`<li><a rel="next" href="${href(page + 1)}" class="next js-search-link"><i class="material-icons">&#xE315;</i></a></li>`);
  return `<nav class="pagination"><div class="col-md-10"><ul class="page-list clearfix text-xs-center">${li.join('')}</ul></div></nav>`;
}

const OPEN = '<div id="js-product-list">';
const CLOSE = '<div id="js-product-list-bottom">';

// Replace only the listing block of an exported page. Returns null if the
// markers are absent, so a caller can fall back to the static page untouched
// rather than serve a mangled one.
export function injectListing(html, inner) {
  const a = html.indexOf(OPEN);
  if (a < 0) return null;
  const b = html.indexOf(CLOSE, a);
  if (b < 0) return null;
  return html.slice(0, a + OPEN.length) + '\n' + inner + '\n</div>\n        ' + html.slice(b);
}

export function setTitle(html, title) {
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
}

export function emptyMessage(iso, term) {
  return iso === 'qc'
    ? `<div class="alert alert-warning">Aucun produit ne correspond a &laquo;&nbsp;${esc(term)}&nbsp;&raquo;.</div>`
    : `<div class="alert alert-warning">No products match &ldquo;${esc(term)}&rdquo;.</div>`;
}
