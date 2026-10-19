# Point every internal reference at the site root instead of the origin host, so
# the export is host-independent and testable on *.pages.dev.
# Canonical / og:url / hreflang / JSON-LD stay ABSOLUTE - they must be.
import os, re, sys

root = sys.argv[1]
host = sys.argv[2]
dry = '--dry' in sys.argv

ABS = re.compile(r'(?:https?:)?//' + re.escape(host) + r'/')
# regions whose absolute URLs must survive untouched
KEEP = [
    re.compile(r'<link[^>]+rel=["\']canonical["\'][^>]*>', re.I),
    re.compile(r'<link[^>]+rel=["\']alternate["\'][^>]*>', re.I),
    re.compile(r'<meta[^>]+(?:property|name)=["\'](?:og:url|twitter:url)["\'][^>]*>', re.I),
    re.compile(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>.*?</script>', re.I | re.S),
]

files = {'html': 0, 'css': 0}
subs = 0
kept = 0
for dp, _dn, fn in os.walk(root):
    for f in fn:
        ext = 'html' if f.endswith('.html') else ('css' if f.endswith('.css') else None)
        if not ext:
            continue
        p = os.path.join(dp, f)
        try:
            text = open(p, encoding='utf-8', errors='surrogateescape').read()
        except OSError:
            continue
        orig = text
        holds = []
        if ext == 'html':
            for pat in KEEP:
                def stash(m):
                    holds.append(m.group(0))
                    return '\x00KEEP%d\x00' % (len(holds) - 1)
                text = pat.sub(stash, text)
        text, n = ABS.subn('/', text)
        if ext == 'html':
            kept += sum(len(ABS.findall(h)) for h in holds)
            for i, h in enumerate(holds):
                text = text.replace('\x00KEEP%d\x00' % i, h)
        if text != orig:
            subs += n
            files[ext] += 1
            if not dry:
                open(p, 'w', encoding='utf-8', errors='surrogateescape').write(text)

print('%s: rewrote %d absolute refs in %d html + %d css files; left %d absolute in canonical/alternate/og/ld+json'
      % ('DRY RUN' if dry else 'APPLIED', subs, files['html'], files['css'], kept))
