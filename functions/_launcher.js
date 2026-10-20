// On-demand PrestaShop admin launcher, on the site's own domain.
//
// Routed at /admin168we3cgm/ - the shop's real admin directory - so the owner
// uses the URL they already know, the way bodyspiritcentre keeps /wp-admin.
// Lives in _launcher.js because a leading underscore is not routed by Pages;
// functions/admin168we3cgm/index.js and [[path]].js bind it to the path.
//
// IT AUTO-STARTS, BUT NOT ON THE GET ITSELF. The owner wanted no button. The
// GET therefore returns a spinner page, and that page's own JavaScript POSTs
// to start the session. The distinction is the whole safety margin:
//
//   * On the two sibling launchers in this estate, dispatching on the GET got
//     them driven roughly HOURLY by scanners - 659 admin visits logged on one
//     site in a single day, from France, Russia and the US - and every probe
//     spent a runner and put a login on the internet.
//   * A user-agent filter did NOT stop it. They send a normal browser UA on
//     the first request and only reveal python-requests on follow-ups.
//   * What those tools do not do is execute JavaScript. So the dispatch sits
//     behind a POST that only a real browser makes, and the owner still never
//     clicks anything.
//
// This path is also the directory that held the unauthenticated
// reset-password.php backdoor (it set employee #1 to a known password) and a
// publicly downloadable themes.tar, both quarantined 2026-10-18. Attackers
// know it. Cloudflare Access scoped to this path remains the real fix; this is
// the best available without a second login.
//
// It REDIRECTS into the session rather than proxying it. The image generates
// its own admin directory name (admin650a7u3gr, and different every run), and
// PrestaShop keeps its own domain in ps_shop_url, which the workflow points at
// the tunnel - so a proxied admin would emit links to the wrong origin and
// drop its login cookie on the wrong domain.
const OWNER = 'ryx168';
const REPO = 'mlicanada_site';
const WORKFLOW = 'admin.yml';
const SESSION_BRANCH = 'session';
const SESSION_FILE = 'session.json';

// 330 minutes. The owner asked for up to six hours; GitHub kills a job at six
// (360), and the workflow's timeout-minutes is 350 so the catalogue-save step
// still gets to run. 330 leaves headroom for boot and save. There is no idle
// timeout - it runs until this expires or until Close is pressed.
const MINUTES = '330';

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

// Returns {state, id}. The id is needed to cancel.
async function currentRun(env) {
  const r = await gh(env, '/actions/workflows/' + WORKFLOW + '/runs?per_page=5');
  if (!r.ok) return { state: 'unknown', id: null };
  const d = await r.json();
  for (const run of (d.workflow_runs || [])) {
    if (run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting') {
      return { state: 'starting', id: run.id };
    }
  }
  return { state: 'idle', id: null };
}

// Mitigation, not the safety margin - the JavaScript requirement is. Kept
// because it costs nothing and turns away the unsophisticated majority.
function looksLikeAPerson(request) {
  const ua = (request.headers.get('user-agent') || '').toLowerCase();
  if (!ua) return false;
  return !/bot|crawl|spider|curl|wget|python|requests|httpx|go-http|java|libwww|scrapy/.test(ua);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = 'body{font:15px/1.6 -apple-system,"Segoe UI",Roboto,Arial,sans-serif;'
  + 'background:#f4f5f7;color:#1c1e21;display:grid;place-items:center;min-height:100vh;margin:0}'
  + '.c{background:#fff;padding:30px 28px;border-radius:12px;width:min(92vw,430px);text-align:center;'
  + 'box-shadow:0 1px 3px rgba(0,0,0,.12),0 8px 24px rgba(0,0,0,.08)}'
  + 'h1{font-size:19px;margin:0 0 6px}p{color:#606770;font-size:14px;margin:0 0 16px}'
  + 'button,a.b{display:block;width:100%;box-sizing:border-box;padding:11px;margin-top:8px;'
  + 'font:600 15px/1 inherit;color:#fff;background:#1877f2;border:0;border-radius:8px;'
  + 'cursor:pointer;text-align:center;text-decoration:none}'
  + 'button.sec{background:#e4e6eb;color:#1c1e21}'
  + 'button[disabled]{opacity:.6;cursor:default}small{color:#8a8d91;font-size:12px}'
  + '.sp{width:42px;height:42px;margin:4px auto 18px;border:4px solid #dfe3e8;'
  + 'border-top-color:#1877f2;border-radius:50%;animation:s 1s linear infinite}'
  + '@keyframes s{to{transform:rotate(360deg)}}'
  + '.bar{height:4px;background:#dfe3e8;border-radius:2px;overflow:hidden;margin:14px 0 0}'
  + '.bar i{display:block;height:100%;width:30%;background:#1877f2;border-radius:2px;'
  + 'animation:b 1.6s ease-in-out infinite}'
  + '@keyframes b{0%{margin-left:-30%}100%{margin-left:100%}}'
  + '@media(prefers-color-scheme:dark){body{background:#18191a;color:#e4e6eb}'
  + '.c{background:#242526;box-shadow:none}p{color:#b0b3b8}button.sec{background:#3a3b3c;color:#e4e6eb}'
  + '.sp,.bar{border-color:#3a3b3c;background:#3a3b3c}}';

function page(body, status) {
  const html = '<!doctype html><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex,nofollow"><title>MLI Canada admin</title>'
    + '<style>' + CSS + '</style><div class="c">' + body + '</div>';
  return new Response(html, { status: status || 200, headers: H });
}

// The spinner page. Its script does the POST, so the GET itself never spends a
// runner. The <noscript> fallback is a real button, so the admin is still
// reachable with JavaScript off.
function startingPage(alreadyRunning) {
  return page('<div class="sp"></div>'
    + '<h1>' + (alreadyRunning ? 'Starting&hellip;' : 'Starting the admin&hellip;') + '</h1>'
    + '<p>Loading the catalogue, theme and product images. This takes about'
    + ' three minutes.</p><div class="bar"><i></i></div>'
    + '<p style="margin:16px 0 0"><small>The admin opens by itself when it is ready.'
    + ' Add <code>?logout</code> to this address to log out and close.</small></p>'
    + '<noscript><p><b>JavaScript is off.</b></p>'
    + '<form method="POST"><button type="submit">Start the admin</button></form></noscript>'
    + '<script>'
    + 'var started=' + (alreadyRunning ? 'true' : 'false') + ';'
    + 'function poll(){location.reload()}'
    + 'if(started){setTimeout(poll,10000)}else{'
    + 'fetch(location.pathname,{method:"POST",headers:{"x-start":"1"}})'
    + '.then(function(){setTimeout(poll,10000)})'
    + '.catch(function(){setTimeout(poll,10000)})}'
    + '</script>');
}

export async function launcherGet({ request, env }) {
  if (!env.GH_TOKEN) {
    return page('<h1>Not configured</h1><p>This launcher needs a <code>GH_TOKEN</code>'
      + ' secret on the Pages project - a fine-grained token with Actions read/write'
      + ' and Contents read on the site repo.</p>', 503);
  }

  // ?manage, ?close or ?logout asks for the control panel. Without it, an open
  // session redirects STRAIGHT into the admin - the owner asked for one hop,
  // not a page with a button on it. The panel has to stay reachable somehow,
  // or there would be no way to press Close.
  let manage = false;
  try {
    const q = new URL(request.url).searchParams;
    manage = q.has('manage') || q.has('close') || q.has('logout');
  } catch (e) { /* no URL on a bare mock: treat as a plain visit */ }

  const live = await liveSession(env);
  if (live && !manage) {
    return new Response(null, {
      status: 302,
      headers: Object.assign({}, H, { location: live.admin_url }),
    });
  }
  if (live) {
    const closes = new Date(live.expires_at);
    const leftMin = Math.max(0, Math.round((closes - Date.now()) / 60000));
    return page('<h1>The admin is open</h1>'
      + '<p>Open for about ' + leftMin + ' more minutes, or until you close it.</p>'
      + '<a class="b" href="' + esc(live.admin_url) + '">Open the admin</a>'
      + '<form method="POST" id="cf"><input type="hidden" name="intent" value="close">'
      + '<button class="sec" type="submit">Log out and close the admin</button></form>'
      + '<p style="margin:14px 0 0"><small>Sign in as harry@superesolutions.com'
      + ' (or admin@mlicanada.com). Closing saves'
      + ' your catalogue edits first - closing IS the logout, since the server and'
      + ' its session cease to exist. The address is temporary and changes every'
      + ' session. Visiting this path without <code>?manage</code> goes straight'
      + ' to the admin.</small></p>'
      + '<script>document.getElementById("cf").addEventListener("submit",function(e){'
      + 'if(!confirm("Log out and close the admin? Your edits are saved first.")){e.preventDefault()}})</script>');
  }

  // No session. Show the spinner and let its script start one - a GET must
  // never dispatch. If a run is already on its way, just wait for it.
  const run = await currentRun(env);
  return startingPage(run.state === 'starting');
}

export async function launcherPost({ request, env }) {
  if (!env.GH_TOKEN) return page('<h1>Not configured</h1>', 503);

  // Read the intent without trusting content-type. A browser form sends
  // application/x-www-form-urlencoded, but gating on that header made the
  // Close button fall through to the start path whenever the header was
  // absent or unexpected - a silent and confusing failure.
  let intent = '';
  try {
    intent = String((await request.formData()).get('intent') || '');
  } catch (e) { /* no form body: this is a start */ }

  if (intent === 'close') {
    const run = await currentRun(env);
    if (!run.id) return page('<h1>Nothing to close</h1><p>No session is running.</p>');
    // Cancelling is safe: the catalogue-save step is `if: always()`, so edits
    // are committed on the way out, and the session address is retracted.
    const r = await gh(env, '/actions/runs/' + run.id + '/cancel', { method: 'POST' });
    if (!r.ok && r.status !== 409) {
      return page('<h1>Could not close it</h1><p>GitHub answered ' + r.status
        + '. It will close on its own at the end of the session.</p>', 502);
    }
    return page('<h1>Logged out, closing&hellip;</h1>'
      + '<p>The server is shutting down and your catalogue edits are being saved.</p>'
      + '<div class="bar"><i></i></div>'
      + '<script>setTimeout(function(){location.href=location.pathname},15000)</script>');
  }

  // A start. The JavaScript requirement is the gate; this is belt and braces.
  if (!looksLikeAPerson(request)) {
    return page('<h1>Not started</h1><p>Open this page in a browser.</p>', 403);
  }

  const live = await liveSession(env);
  if (live) return Response.redirect(live.admin_url, 302);

  const run = await currentRun(env);
  if (run.state === 'starting') return startingPage(true);

  const r = await gh(env, '/actions/workflows/' + WORKFLOW + '/dispatches', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { minutes: MINUTES, republish: 'false' } }),
  });
  if (!r.ok) {
    return page('<h1>Could not start it</h1><p>GitHub answered ' + r.status
      + '. The token is probably missing Actions write on the repo.</p>', 502);
  }
  return startingPage(true);
}
