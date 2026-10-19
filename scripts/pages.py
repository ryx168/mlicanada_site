# Harvest same-host PAGE links from the export (closure pass). Excludes the
# transactional/account paths a static mirror must not carry.
import os, re, sys
from urllib.parse import urljoin, urlparse

root, host, outfile = sys.argv[1], sys.argv[2], sys.argv[3]
HREF = re.compile(r'href\s*=\s*["\']([^"\']+)', re.I)
ASSET = ('.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
         '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.webm', '.pdf', '.xml')
SKIP = ('/cart', '/order', '/checkout', '/my-account', '/authentication', '/identity',
        '/addresses', '/address', '/discount', '/credit-slip', '/order-history',
        '/order-follow', '/guest-tracking', '/password-recovery', '/registration',
        '/search', '/comparison', '/wishlist', '/module/', '/index.php', '/login',
        '/logout', '/quick-order', '/order-confirmation')

found = set()
for dp, _dn, fn in os.walk(root):
    for f in fn:
        if not f.endswith('.html'):
            continue
        p = os.path.join(dp, f)
        rel = os.path.relpath(p, root).replace(os.sep, '/')
        pageurl = 'https://%s/%s' % (host, rel)
        try:
            text = open(p, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        for cand in HREF.findall(text):
            cand = cand.strip()
            if not cand or cand[0] == '#' or cand.startswith(('data:', 'mailto:', 'tel:', 'javascript:')):
                continue
            pr = urlparse(urljoin(pageurl, cand))
            # Ignore the query string rather than skipping the URL: blog posts are
            # linked as ...html?page_type=post and the page exists at the bare path.
            if pr.netloc != host:
                continue
            path = pr.path
            if path.lower().endswith(ASSET) or not re.match(r'^/(en|qc)(/|$)', path):
                continue
            if any(s in path for s in SKIP):
                continue
            found.add('https://%s%s' % (host, path))

with open(outfile, 'w') as fh:
    for u in sorted(found):
        fh.write(u + '\n')
print('page links referenced:', len(found))
