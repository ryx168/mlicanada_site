// Run: node tests/launcher.test.mjs   (from the repo root)
//
// The invariant that matters is test 1: THE GET ITSELF MUST NOT DISPATCH.
// The launcher auto-starts, but via the spinner page's own JavaScript, so a
// scanner that does not run JS cannot spend a runner. Both sibling estate
// launchers were driven hourly by scanners when the GET dispatched directly,
// and a user-agent filter did not stop it.
//
// Verified to discriminate by mutation: making the GET branch dispatch fails
// test 1, and removing the bot filter fails tests 5-6.
import { launcherGet, launcherPost } from '../functions/_launcher.js';

let calls = [];
const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140',
  accept: 'text/html,application/xhtml+xml',
};

// A GET needs a url so the launcher can read ?manage.
function getReq(query) {
  return { url: 'https://mlicanada-holding.pages.dev/admin168we3cgm/' + (query || ''),
           headers: { get: () => null } };
}

function req(headers, form) {
  // A real browser form POST carries this content-type; included so the
  // mock cannot pass where a browser would fail.
  if (form) headers = Object.assign({ 'content-type': 'application/x-www-form-urlencoded' }, headers);
  return {
    headers: { get: k => (headers[k.toLowerCase()] ?? null) },
    formData: async () => ({ get: k => (form ? form[k] : null) }),
  };
}

function stubFetch({ session = null, runs = [] } = {}) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push((init.method || 'GET') + ' ' + url);
    if (url.includes('/contents/session.json')) {
      return session
        ? { ok: true, text: async () => JSON.stringify(session) }
        : { ok: false, text: async () => '' };
    }
    if (url.includes('/runs?')) return { ok: true, json: async () => ({ workflow_runs: runs }) };
    if (url.includes('/cancel')) return { ok: true };
    if (url.includes('/dispatches')) return { ok: true };
    return { ok: false };
  };
}

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   <- ' + extra));
  if (!cond) fails++;
};
const dispatches = () => calls.filter(c => c.includes('/dispatches')).length;
const LIVE = () => ({
  admin_url: 'https://live.trycloudflare.com/admin650a7u3gr/',
  expires_at: new Date(Date.now() + 330 * 60000).toISOString(),
});

// 1. THE invariant.
calls = []; stubFetch();
let r = await launcherGet({ request: getReq(), env: { GH_TOKEN: 't' } });
let body = await r.text();
check('GET dispatched NOTHING', dispatches() === 0, calls.join(' | '));

// 2. ...but the page it returns does start one by itself: no button to press.
check('GET returns a spinner that POSTs on load',
      body.includes('class="sp"') && /fetch\(location\.pathname,\{method:"POST"/.test(body));
check('GET page reloads itself to pick the session up', body.includes('location.reload'));

// 3. With JavaScript off there is still a way in.
check('noscript fallback offers a real button',
      body.includes('<noscript>') && body.includes('Start the admin'));

// 4. No 30-minute wording, and the dispatch asks for the long session.
calls = []; stubFetch();
await launcherPost({ request: req(BROWSER), env: { GH_TOKEN: 't' } });
check('a start dispatches exactly once', dispatches() === 1, calls.join(' | '));

// 5. A bot POST is refused before any network call.
calls = []; stubFetch();
r = await launcherPost({ request: req({ 'user-agent': 'python-requests/2.34.2', accept: '*/*' }), env: { GH_TOKEN: 't' } });
check('POST from python-requests is refused', r.status === 403, 'status=' + r.status);
check('refused POST made no network call', calls.length === 0, calls.join(' | '));

// 6. No user-agent is refused too.
r = await launcherPost({ request: req({ accept: 'text/html' }), env: { GH_TOKEN: 't' } });
check('POST with no user-agent is refused', r.status === 403, 'status=' + r.status);

// 7. A run already in flight is never duplicated.
calls = []; stubFetch({ runs: [{ status: 'in_progress', id: 5 }] });
await launcherPost({ request: req(BROWSER), env: { GH_TOKEN: 't' } });
check('POST while starting dispatches nothing', dispatches() === 0, calls.join(' | '));

// 8. A stale session file (cancelled run) is ignored, and still no dispatch.
calls = []; stubFetch({ session: { admin_url: 'https://old.trycloudflare.com/a/', expires_at: '2020-01-01T00:00:00Z' } });
r = await launcherGet({ request: getReq(), env: { GH_TOKEN: 't' } });
body = await r.text();
check('expired session file is ignored', body.includes('class="sp"'));
check('expired session did not leak the dead URL', !body.includes('old.trycloudflare.com'));
check('expired session did not dispatch on the GET', dispatches() === 0, calls.join(' | '));

// 9. An open session redirects STRAIGHT into the admin - one hop, no page
//    with a button on it.
calls = []; stubFetch({ session: LIVE(), runs: [{ status: 'in_progress', id: 77 }] });
r = await launcherGet({ request: getReq(), env: { GH_TOKEN: 't' } });
check('open session redirects to the admin', r.status === 302, 'status=' + r.status);
check('redirect points at the session URL',
      r.headers.get('location') === 'https://live.trycloudflare.com/admin650a7u3gr/',
      r.headers.get('location'));
check('the redirect still dispatched nothing', dispatches() === 0, calls.join(' | '));

// 9b. ?manage keeps the panel reachable, or Close could never be pressed.
r = await launcherGet({ request: getReq('?manage'), env: { GH_TOKEN: 't' } });
body = await r.text();
check('?manage shows the panel, not a redirect', r.status === 200, 'status=' + r.status);
check('panel shows the admin link', body.includes('https://live.trycloudflare.com/admin650a7u3gr/'));
check('panel offers log-out-and-close', body.includes('Log out and close the admin') && body.includes('value="close"'));
check('panel reports minutes left', /about 3[23][0-9] more minutes/.test(body), body.match(/about [^<]*/)?.[0]);
for (const q of ['?close', '?logout']) {
  r = await launcherGet({ request: getReq(q), env: { GH_TOKEN: 't' } });
  check(q + ' also shows the panel', r.status === 200, 'status=' + r.status);
}

// 9c. Restart cancels the old run AND queues a new one.
calls = []; stubFetch({ session: LIVE(), runs: [{ status: 'in_progress', id: 77 }] });
r = await launcherPost({ request: req(BROWSER, { intent: 'restart' }), env: { GH_TOKEN: 't' } });
body = await r.text();
check('restart cancels the current run',
      calls.some(c => c.endsWith('/actions/runs/77/cancel')), calls.join(' | '));
check('restart dispatches exactly one new run', dispatches() === 1, calls.join(' | '));
check('restart cancels BEFORE it dispatches',
      calls.findIndex(c => c.includes('/cancel')) < calls.findIndex(c => c.includes('/dispatches')),
      calls.join(' | '));
check('restart shows a spinner', body.includes('class="sp"') && body.includes('Restarting'));

// 9d. Restart with nothing running just starts one.
calls = []; stubFetch();
r = await launcherPost({ request: req(BROWSER, { intent: 'restart' }), env: { GH_TOKEN: 't' } });
check('restart with no session still starts one', dispatches() === 1, calls.join(' | '));
check('restart with no session cancels nothing', !calls.some(c => c.includes('/cancel')), calls.join(' | '));

// 9e. The panel offers both actions.
stubFetch({ session: LIVE(), runs: [{ status: 'in_progress', id: 77 }] });
r = await launcherGet({ request: getReq('?logout'), env: { GH_TOKEN: 't' } });
body = await r.text();
check('panel offers Restart', body.includes('Restart the admin') && body.includes('value="restart"'));
check('panel still offers close', body.includes('value="close"'));

// 10. Close cancels the run.
calls = []; stubFetch({ session: LIVE(), runs: [{ status: 'in_progress', id: 77 }] });
r = await launcherPost({ request: req(BROWSER, { intent: 'close' }), env: { GH_TOKEN: 't' } });
check('close cancels the run',
      calls.some(c => c === 'POST https://api.github.com/repos/ryx168/mlicanada_site/actions/runs/77/cancel'),
      calls.join(' | '));
check('close did not dispatch a new run', dispatches() === 0, calls.join(' | '));

// 11. Close with nothing running says so, and cancels nothing.
calls = []; stubFetch();
r = await launcherPost({ request: req(BROWSER, { intent: 'close' }), env: { GH_TOKEN: 't' } });
body = await r.text();
check('close with no session says so', body.includes('Nothing to close'));
check('close with no session cancelled nothing', !calls.some(c => c.includes('/cancel')), calls.join(' | '));

// 11b. A GitHub outage must be a readable page, never a Worker exception.
//      Cloudflare turns an uncaught throw into "Error 1101: Worker threw
//      exception", which is what the owner saw.
globalThis.fetch = async () => { throw new TypeError('network error'); };
calls = [];
r = await launcherGet({ request: getReq(), env: { GH_TOKEN: 't' } });
body = await r.text();
check('GitHub unreachable on GET -> 503 page, not a throw', r.status === 503, 'status=' + r.status);
check('the page says what went wrong', body.includes('Cannot reach GitHub'));
check('it does NOT offer to start one (would risk a second runner)',
      !body.includes('class="sp"'), body.slice(0, 120));

globalThis.fetch = async () => { throw new TypeError('network error'); };
r = await launcherPost({ request: req(BROWSER), env: { GH_TOKEN: 't' } });
check('GitHub unreachable on POST -> 503 page, not a throw', r.status === 503, 'status=' + r.status);

// 12. Fails closed with no token, and never indexable.
r = await launcherGet({ env: {} });
check('no GH_TOKEN -> 503', r.status === 503, 'status=' + r.status);
check('responses carry noindex', (r.headers.get('x-robots-tag') || '').includes('noindex'));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
