// Run: node tests/launcher.test.mjs   (from the repo root)
//
// The invariant that matters is test 1: a GET must never dispatch a run.
// Both sibling estate launchers were driven hourly by scanners when a GET
// auto-started a session. Verified to discriminate by mutation: making the
// GET branch dispatch fails test 1, and removing the bot filter fails
// tests 2-3.
// Exercises the launcher's gates without a network or a Pages runtime.
import { onRequestGet, onRequestPost } from '../functions/m-99dbcd78867fdadc.js';

let calls = [];
const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140',
  accept: 'text/html,application/xhtml+xml',
};

function req(method, headers) {
  return { headers: { get: k => (headers[k.toLowerCase()] ?? null) }, method };
}

// Stub: no live session (404 on the session file), and no run in flight.
function stubFetch({ session = null, runs = [] } = {}) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push((init.method || 'GET') + ' ' + url);
    if (url.includes('/contents/session.json')) {
      return session
        ? { ok: true, text: async () => JSON.stringify(session) }
        : { ok: false, text: async () => '' };
    }
    if (url.includes('/runs?')) {
      return { ok: true, json: async () => ({ workflow_runs: runs }) };
    }
    if (url.includes('/dispatches')) return { ok: true };
    return { ok: false };
  };
}

let fails = 0;
const check = (name, cond, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   <- ' + extra));
  if (!cond) fails++;
};

// 1. THE invariant: a GET must never dispatch a run.
calls = []; stubFetch();
let r = await onRequestGet({ env: { GH_TOKEN: 't' } });
let body = await r.text();
check('GET with no session returns 200 and offers a button',
      r.status === 200 && body.includes('Start the admin'), 'status=' + r.status);
check('GET dispatched NOTHING',
      !calls.some(c => c.includes('/dispatches')), calls.join(' | '));

// 2. A bot POST is refused before any network call.
calls = []; stubFetch();
r = await onRequestPost({ request: req('POST', { 'user-agent': 'python-requests/2.34.2', accept: '*/*' }), env: { GH_TOKEN: 't' } });
check('POST from python-requests is refused', r.status === 403, 'status=' + r.status);
check('refused POST made no network call at all', calls.length === 0, calls.join(' | '));

// 3. A POST with no user-agent is refused.
r = await onRequestPost({ request: req('POST', { accept: 'text/html' }), env: { GH_TOKEN: 't' } });
check('POST with no user-agent is refused', r.status === 403, 'status=' + r.status);

// 4. A browser POST does dispatch, exactly once.
calls = []; stubFetch();
r = await onRequestPost({ request: req('POST', BROWSER), env: { GH_TOKEN: 't' } });
check('browser POST dispatches', calls.filter(c => c.includes('/dispatches')).length === 1, calls.join(' | '));

// 5. A browser POST while a run is already in flight must NOT dispatch again.
calls = []; stubFetch({ runs: [{ status: 'in_progress' }] });
r = await onRequestPost({ request: req('POST', BROWSER), env: { GH_TOKEN: 't' } });
check('POST while starting dispatches nothing',
      !calls.some(c => c.includes('/dispatches')), calls.join(' | '));

// 6. An EXPIRED session file must be treated as no session (a cancelled run
//    leaves the file behind), and must still not auto-start on GET.
calls = []; stubFetch({ session: { admin_url: 'https://old.trycloudflare.com/admin/', expires_at: '2020-01-01T00:00:00Z' } });
r = await onRequestGet({ env: { GH_TOKEN: 't' } });
body = await r.text();
check('expired session file is ignored', body.includes('Start the admin'), body.slice(0, 80));
check('expired session did not leak the dead URL', !body.includes('old.trycloudflare.com'));

// 7. A live session is offered as a link, not auto-followed.
stubFetch({ session: { admin_url: 'https://live.trycloudflare.com/admin168we3cgm/', expires_at: new Date(Date.now() + 36e5).toISOString() } });
r = await onRequestGet({ env: { GH_TOKEN: 't' } });
body = await r.text();
check('live session shows the admin link',
      body.includes('https://live.trycloudflare.com/admin168we3cgm/') && body.includes('Open the admin'));

// 8. Missing GH_TOKEN fails closed with a clear message.
r = await onRequestGet({ env: {} });
check('no GH_TOKEN -> 503', r.status === 503, 'status=' + r.status);

// 9. noindex on every response.
check('responses carry noindex', (r.headers.get('x-robots-tag') || '').includes('noindex'));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
