// On-demand PrestaShop admin launcher, on the site's own domain.
//
// Same shape as the bodyspiritcentre /wp-admin launcher, and it carries that
// project's hard-won rule: A GET NEVER STARTS A SESSION. When those launchers
// auto-started on GET, scanners from France, Russia and the US drove them
// roughly hourly - 659 admin visits logged on one site in a single day - and
// every probe spent a runner and put a login on the internet. A user-agent
// filter did NOT stop it: they send a browser UA on the first request and only
// reveal the tool on follow-ups. So a GET renders a button, and only a POST
// dispatches.
//
// The path is deliberately random rather than /admin or /wp-admin. That is not
// a password - it only keeps scanners away from the Start button. The gate on
// the admin itself is the PrestaShop login (the ADMIN_PASSWORD repo secret).
//
// It REDIRECTS into the session rather than proxying it. Proxying would keep
// the URL on this domain, but PrestaShop stores its own domain in ps_shop_url
// and ps_configuration and the workflow points those at the tunnel host, so a
// proxied admin would emit links to the wrong origin and drop its login cookie
// on the wrong domain. bodyspiritcentre can proxy only because WordPress is
// told to use the LIVE host there.
const OWNER = 'ryx168';
const REPO = 'mlicanada_site';
const WORKFLOW = 'admin.yml';
const SESSION_BRANCH = 'session';
const SESSION_FILE = 'session.json';
const MINUTES = '30';

const H = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
};

function gh(env, path, init) {
  init = init || {};
  const headers = Object.assign({
    accept: 'application/vnd.github+json',
    authorization: 'Bearer ' + env.GH_TOKEN,
    'user-agent': 'mlicanada-admin-launcher',
  }, init.headers || {});
  return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + path,
               Object.assign({}, init, { headers: headers }));
}

// The live session's address is published by the workflow onto a side branch,
// because the tunnel hostname is random and changes every run. Read it through
// the API rather than raw.githubusercontent, which caches for minutes.
async function liveSession(env) {
  const r = await gh(env, '/contents/' + SESSION_FILE + '?ref=' + SESSION_BRANCH,
                     { headers: { accept: 'application/vnd.github.raw' } });
  if (!r.ok) return null;
  let s;
  try { s = JSON.parse(await r.text()); } catch (e) { return null; }
  if (!s || !s.admin_url || !s.expires_at) return null;
  // A run that is cancelled or dies leaves the file behind, so never trust it
  // past its own stated expiry.
  if (Date.parse(s.expires_at) < Date.now()) return null;
  return s;
}

async function runState(env) {
  const r = await gh(env, '/actions/workflows/' + WORKFLOW + '/runs?per_page=5');
  if (!r.ok) return 'unknown';
  const d = await r.json();
  for (const run of (d.workflow_runs || [])) {
    if (run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting') {
      return 'starting';
    }
  }
  return 'idle';
}

// Mitigation, not a fix - see the note at the top. Kept because it costs
// nothing and turns away the unsophisticated majority.
function looksLikeAPerson(request) {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (!ua) return false;
  if (!(request.headers.get('accept') || '').includes('text/html')) return false;
  return !/bot|crawl|spider|curl|wget|python|requests|httpx|go-http|java|libwww|scrapy|headless/.test(ua);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(body, status) {
  const html = '<!doctype html><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>MLI Canada admin</title>'
    + '<style>body{font:15px/1.6 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;'
    + 'background:#f4f5f7;color:#1c1e21;display:grid;place-items:center;min-height:100vh;margin:0}'
    + '.c{background:#fff;padding:30px 28px;border-radius:12px;width:min(92vw,430px);'
    + 'box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08)}'
    + 'h1{font-size:19px;margin:0 0 6px}p{color:#606770;font-size:14px;margin:0 0 16px}'
    + 'button,a.b{display:block;width:100%;box-sizing:border-box;padding:11px;'
    + 'font:600 15px/1 inherit;color:#fff;background:#1877f2;border:0;border-radius:8px;'
    + 'cursor:pointer;text-align:center;text-decoration:none}'
    + 'button[disabled]{opacity:.6;cursor:default}small{color:#8a8d91;font-size:12px}'
    + '@media(prefers-color-scheme:dark){body{background:#18191a;color:#e4e6eb}'
    + '.c{background:#242526;box-shadow:none}p{color:#b0b3b8}}</style>'
    + '<div class="c">' + body + '</div>';
  return new Response(html, { status: status || 200, headers: H });
}

const WAIT_SCRIPT = '<script>setTimeout(function(){location.reload()},10000)</script>';

export async function onRequestGet({ env }) {
  if (!env.GH_TOKEN) {
    return page('<h1>Not configured</h1><p>This launcher needs a <code>GH_TOKEN</code>'
      + ' secret on the Pages project - a fine-grained token with Actions read/write'
      + ' and Contents read on the site repo.</p>', 503);
  }

  const live = await liveSession(env);
  if (live) {
    return page('<h1>The admin is open</h1>'
      + '<p>This session closes at ' + esc(new Date(live.expires_at).toUTCString()) + '.</p>'
      + '<a class="b" href="' + esc(live.admin_url) + '">Open the admin</a>'
      + '<p style="margin:14px 0 0"><small>Sign in as admin@mlicanada.com. The address is'
      + ' temporary and changes every session.</small></p>');
  }

  if ((await runState(env)) === 'starting') {
    return page('<h1>Starting&hellip;</h1><p>A session is booting - about three minutes,'
      + ' while the catalogue and theme load. This page checks every ten seconds.</p>'
      + WAIT_SCRIPT);
  }

  // A GET only ever offers the button. It must never dispatch.
  return page('<h1>The admin is not running</h1>'
    + '<p>It starts on demand, runs for ' + MINUTES + ' minutes and then shuts down.'
    + ' Nothing is hosted between sessions.</p>'
    + '<form method="POST"><button id="b" type="submit">Start the admin</button></form>'
    + '<script>document.forms[0].addEventListener("submit",function(){'
    + 'var b=document.getElementById("b");b.disabled=true;b.textContent="Starting..."})</script>');
}

export async function onRequestPost({ request, env }) {
  if (!env.GH_TOKEN) return page('<h1>Not configured</h1>', 503);
  if (!looksLikeAPerson(request)) {
    return page('<h1>Not started</h1><p>Start the admin from a browser.</p>', 403);
  }

  // Never pile runs up. Reloading the waiting page used to dispatch a second
  // run on the sibling projects, because the check raced the dispatch.
  const live = await liveSession(env);
  if (live) return Response.redirect(live.admin_url, 302);
  if ((await runState(env)) === 'starting') {
    return page('<h1>Already starting</h1><p>A session is on its way.</p>' + WAIT_SCRIPT);
  }

  const r = await gh(env, '/actions/workflows/' + WORKFLOW + '/dispatches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { minutes: MINUTES, republish: 'false' } }),
  });
  if (!r.ok) {
    return page('<h1>Could not start it</h1><p>GitHub answered ' + r.status
      + '. The token is probably missing Actions write on the repo.</p>', 502);
  }
  return page('<h1>Starting&hellip;</h1><p>About three minutes. This page checks every'
    + ' ten seconds.</p>' + WAIT_SCRIPT);
}
