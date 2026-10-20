"""Refuse to publish an export whose pages reference files that are not there.

Generalised from the skill's check-assets.py, which hard-codes
LOCAL = ("/wp-content/", "/wp-includes/") and therefore checks NOTHING on a
non-WordPress export - it passed a deliberately broken reference on this
PrestaShop tree. Here any same-host reference with a file extension is checked,
and page links are checked against the .html / index.html layouts Pages serves.

A reference may also be satisfied by a _redirects rule rather than a file:
`/`, `/2-products` and the account paths are served that way on Pages, and
they are referenced by every page in the export. Pass --redirects to count
those as present; without it the check refuses a site that works.

Usage: check-refs.py EXPORT_DIR HOST [--list] [--known known.txt]
                     [--redirects _redirects]
"""
import os, posixpath, re, sys, urllib.parse

REF = re.compile(r"""(?:href|src|srcset|data-src|data-image-large-src)\s*=\s*["']([^"']+)["']""", re.I)
SKIP = ("data:", "mailto:", "tel:", "javascript:")
ASSET_EXT = ('.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
             '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.webm', '.pdf')

out, HOST = sys.argv[1], sys.argv[2]
APEX = HOST[4:] if HOST.startswith('www.') else HOST
LIST_ONLY = '--list' in sys.argv[3:]
known = set()
if '--known' in sys.argv:
    kf = sys.argv[sys.argv.index('--known') + 1]
    known = set(l.strip() for l in open(kf) if l.strip())

# Paths served by a _redirects rule instead of a file. Exact sources, plus
# any `/prefix/*` splats, which Pages matches by prefix.
redirect_exact, redirect_splat = set(), []
if '--redirects' in sys.argv:
    rf = sys.argv[sys.argv.index('--redirects') + 1]
    for line in open(rf, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        src = line.split()[0].split('?')[0]
        if src.endswith('/*'):
            redirect_splat.append(src[:-1])
        else:
            redirect_exact.add(src)


def redirected(path):
    if path in redirect_exact:
        return True
    return any(path.startswith(pre) for pre in redirect_splat)


def site_path(page_dir, url):
    url = url.split('#')[0].strip()
    if not url or url.startswith(SKIP):
        return None
    if url.startswith('//'):
        url = 'https:' + url
    if url.startswith('http'):
        parts = urllib.parse.urlparse(url)
        if parts.netloc not in (HOST, APEX):
            return None
        return parts.path
    if url.startswith('/'):
        return url.split('?')[0]
    rel = os.path.relpath(page_dir, out).replace(os.sep, '/')
    base = '/' if rel == '.' else '/' + rel + '/'
    return posixpath.normpath(base + url.split('?')[0])


def exists(path):
    p = urllib.parse.unquote(path).lstrip('/')
    cand = [os.path.join(out, p)]
    if path.endswith('/') or p == '':
        cand.append(os.path.join(out, p, 'index.html'))
    elif not p.lower().endswith('.html'):
        cand += [os.path.join(out, p + '.html'), os.path.join(out, p, 'index.html')]
    return any(os.path.isfile(c) for c in cand)


bad_assets, bad_pages, mangled = {}, {}, {}
checked = {'asset': 0, 'page': 0}
missing_paths = set()
for root, _d, files in os.walk(out):
    for name in files:
        if not name.endswith('.html'):
            continue
        page = os.path.join(root, name)
        with open(page, encoding='utf-8', errors='replace') as fh:
            html = fh.read()
        for raw in REF.findall(html):
            for piece in (raw.split(',') if ' ' in raw and ',' in raw else [raw]):
                u = piece.strip().split(' ')[0]
                path = site_path(root, u)
                if path is None:
                    continue
                is_asset = path.lower().endswith(ASSET_EXT)
                checked['asset' if is_asset else 'page'] += 1
                rel_page = os.path.relpath(page, out).replace(os.sep, '/')
                if '%3F' in path:
                    mangled.setdefault(rel_page, []).append(u)
                    missing_paths.add(path)
                    continue
                if exists(path) or path in known or redirected(path):
                    continue
                target = bad_assets if is_asset else bad_pages
                target.setdefault(rel_page, []).append(u)
                missing_paths.add(urllib.parse.unquote(path))

if LIST_ONLY:
    for p in sorted(missing_paths):
        print(p)
    sys.exit(0)

print('  checked %d asset refs + %d page refs across the export' % (checked['asset'], checked['page']))
print('  known-broken allowance: %d paths' % len(known))
print('  _redirects allowance: %d exact + %d splat'
      % (len(redirect_exact), len(redirect_splat)))
fail = False
for label, d in (('ASSET', bad_assets), ('PAGE', bad_pages), ('QUERY-MANGLED (%3F)', mangled)):
    n = sum(len(v) for v in d.values())
    print('  %-22s missing refs: %d  (on %d pages)' % (label, n, len(d)))
    if n:
        fail = True
        for pg, refs in sorted(d.items())[:5]:
            print('      %s -> %d, e.g. %s' % (pg, len(refs), refs[0][:90]))
if fail:
    print('  REFUSING: see above')
    sys.exit(1)
print('  OK: every same-host reference resolves to an exported file')
