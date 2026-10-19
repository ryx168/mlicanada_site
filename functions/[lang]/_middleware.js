// Cloudflare Pages 308-redirects /path.html to /path. Every product and blog
// URL on this site ends in .html, is the canonical URL in the page's own
// <link rel="canonical">, and returns 200 on the origin - so a 308 here would
// redirect the canonical form of all 543 product pages. Serve those paths
// directly instead.
//
// Scoped to functions/[lang]/ on purpose: /en/ and /qc/ contain nothing but
// HTML, while every asset lives at the root (/themes/, /img/, /modules/, /c/,
// /<id>-*_default/), so this never adds a Function invocation to an asset.
export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  if (url.pathname.endsWith('.html')) {
    const clean = new URL(url);
    clean.pathname = url.pathname.slice(0, -5);
    const res = await env.ASSETS.fetch(new Request(clean.toString(), request));
    if (res.status === 200) {
      const headers = new Headers(res.headers);
      headers.set('x-html-passthrough', '1');
      return new Response(res.body, { status: 200, headers });
    }
  }
  return next();
}
