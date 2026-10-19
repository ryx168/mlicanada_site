"""Verify a DEPLOYED export by content type, with a control that must differ.

The skill's verify-live.py filters references to a fixed list of asset prefixes
(/wp-content/, /assets/, /static/, /css/, /js/). mlicanada.com serves its assets
from /themes/, /img/, /modules/ and /c/, so that filter would check almost
nothing. This checks every same-host reference it finds.

Usage: verify-live-refs.py HOST [--via STAGING_HOST] [--paths FILE]
                           [--known FILE] [--max-pages N] [--max-refs N]
"""
import re, sys, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

REF = re.compile(r"""(?:href|src|srcset|data-src|data-image-large-src)\s*=\s*["']([^"']+)["']""", re.I)
SKIP = ('data:', 'mailto:', 'tel:', 'javascript:', '#')
EXPECT = {
    '.css': 'css', '.js': 'javascript', '.png': 'image/', '.jpg': 'image/',
    '.jpeg': 'image/', '.gif': 'image/', '.webp': 'image/', '.svg': 'image/',
    '.ico': 'image', '.woff': 'font', '.woff2': 'font', '.ttf': 'font',
    '.eot': 'application', '.otf': 'font', '.pdf': 'pdf', '.mp4': 'video',
}
CONTROL = '/themes/Amora/__no_such_file_2f9c1d__.css'

args = sys.argv[1:]
HOST = args[0]
def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default
VIA = opt('--via', HOST)
MAXP = int(opt('--max-pages', '80'))
MAXR = int(opt('--max-refs', '1200'))
known = set()
if '--known' in args:
    known = set(l.strip() for l in open(opt('--known')) if l.strip())
paths = []
if '--paths' in args:
    paths = [l.strip() for l in open(opt('--paths')) if l.strip()]

BASE = 'https://' + VIA


def get(path, body=True):
    url = BASE + path
    # No Host override: Pages routes by Host header, and the real hostname is
    # not a custom domain on the project yet, so overriding it would 404.
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (verify)'})
    try:
        r = urllib.request.urlopen(req, timeout=40)
        data = r.read() if body else b''
        return r.status, r.headers.get('content-type', ''), data, len(data)
    except urllib.error.HTTPError as e:
        try: data = e.read()
        except Exception: data = b''
        return e.code, e.headers.get('content-type', ''), data, len(data)
    except Exception as e:
        return 0, type(e).__name__, b'', 0


ctl_status, ctl_ct, _b, ctl_len = get(CONTROL)
print('  control %s -> %s %s %sb' % (CONTROL, ctl_status, ctl_ct.split(';')[0], ctl_len))

refs = {}
pages_checked = 0
for p in paths[:MAXP]:
    st, ct, body, ln = get(p)
    if st != 200 or 'html' not in ct:
        print('  PAGE FAIL %s -> %s %s' % (p, st, ct.split(';')[0]))
        continue
    pages_checked += 1
    html = body.decode('utf-8', 'replace')
    for raw in REF.findall(html):
        for piece in (raw.split(',') if (' ' in raw and ',' in raw) else [raw]):
            u = piece.strip().split(' ')[0].split('#')[0]
            if not u or u.startswith(SKIP):
                continue
            if u.startswith('//'): u = 'https:' + u
            if u.startswith('http'):
                pr = urllib.parse.urlparse(u)
                if pr.netloc not in (HOST, 'www.' + HOST): continue
                u = pr.path + (('?' + pr.query) if pr.query else '')
            elif not u.startswith('/'):
                base = p if p.endswith('/') else p.rsplit('/', 1)[0] + '/'
                u = urllib.parse.urljoin(base, u)
            refs.setdefault(u.split('?')[0], set()).add(p)

print('  %d pages fetched, %d distinct same-host references' % (pages_checked, len(refs)))
targets = [r for r in sorted(refs) if r not in known][:MAXR]

def probe(r):
    st, ct, _b, ln = get(r, body=False)
    ext = '.' + r.rsplit('.', 1)[-1].lower() if '.' in r.rsplit('/', 1)[-1] else ''
    want = EXPECT.get(ext)
    ok = st == 200 and (want is None or want in ct.lower())
    looks_like_control = (st == ctl_status and ct.split(';')[0] == ctl_ct.split(';')[0])
    return r, st, ct.split(';')[0], ok, want, looks_like_control

bad, like_ctl = [], []
with ThreadPoolExecutor(12) as ex:
    for r, st, ct, ok, want, lc in ex.map(probe, targets):
        if not ok: bad.append((r, st, ct, want))
        if lc and want: like_ctl.append(r)

print('  probed %d references (skipped %d known-broken)' % (len(targets), len(refs) - len(targets)))
print('  wrong status/type : %d' % len(bad))
for r, st, ct, want in bad[:12]:
    print('      %s -> %s %s (wanted %s)' % (r, st, ct, want))
print('  indistinguishable from the control : %d' % len(like_ctl))
sys.exit(1 if bad else 0)
