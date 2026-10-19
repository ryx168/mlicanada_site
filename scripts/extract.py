# Collect every same-host asset reference from the exported HTML and CSS.
import os, re, sys
from urllib.parse import urljoin, urlparse

root, host, outfile = sys.argv[1], sys.argv[2], sys.argv[3]
ATTR = re.compile(r'(?:src|href|srcset|data-src|data-image-large-src|data-full-size-image-url|content)\s*=\s*["\']([^"\']+)', re.I)
CSSU = re.compile(r'url\(\s*["\']?([^"\')]+)', re.I)
EXTS = ('.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
        '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.webm', '.pdf')

refs, queried = set(), set()
for dp, _dn, fn in os.walk(root):
    for f in fn:
        if not f.endswith(('.html', '.css')):
            continue
        p = os.path.join(dp, f)
        rel = os.path.relpath(p, root).replace(os.sep, '/')
        pageurl = 'https://%s/%s' % (host, rel)
        try:
            text = open(p, encoding='utf-8', errors='ignore').read()
        except OSError:
            continue
        for cand in ATTR.findall(text) + CSSU.findall(text):
            cand = cand.strip()
            if not cand or cand[0] == '#' or cand.startswith(('data:', 'mailto:', 'tel:', 'javascript:')):
                continue
            for piece in cand.split(','):
                u = piece.strip().split(' ')[0]
                if not u:
                    continue
                pr = urlparse(urljoin(pageurl, u))
                if pr.netloc != host or not pr.path.lower().endswith(EXTS):
                    continue
                if pr.query:
                    queried.add(pr.path + '?' + pr.query)
                refs.add('https://%s%s' % (host, pr.path))

with open(outfile, 'w') as fh:
    for u in sorted(refs):
        fh.write(u + '\n')
if queried:
    with open(outfile + '.queried', 'w') as fh:
        for u in sorted(queried):
            fh.write(u + '\n')
    sys.stderr.write('NOTE: %d references carry query strings (see %s.queried)\n' % (len(queried), outfile))
