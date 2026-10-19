# Canonical product URLs from the origin. PrestaShop matches on the numeric id
# and 302s to the real {category-path}/{id}-{slug}.html. Runs ON server1.
import sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ids_file, out_file = sys.argv[1], sys.argv[2]
workers = int(sys.argv[3]) if len(sys.argv) > 3 else 6
HOST = sys.argv[4] if len(sys.argv) > 4 else 'https://mlicanada.com'
UA = 'Mozilla/5.0 (static-export)'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


opener = urllib.request.build_opener(NoRedirect)


def probe(arg):
    lang, pid = arg
    url = '%s/%s/products/%s-x.html' % (HOST, lang, pid)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        r = opener.open(req, timeout=30)
        return (lang, pid, r.status, '', '')
    except urllib.error.HTTPError as e:
        return (lang, pid, e.code, e.headers.get('Location', '') or '', '')
    except Exception as e:
        return (lang, pid, 0, '', type(e).__name__ + ': ' + str(e)[:80])


ids = [l.strip() for l in open(ids_file) if l.strip()]
jobs = [(lang, pid) for pid in ids for lang in ('en', 'qc')]
errs = 0
with open(out_file, 'w') as fh, ThreadPoolExecutor(workers) as ex:
    for lang, pid, code, loc, err in ex.map(probe, jobs):
        fh.write('%s\t%s\t%s\t%s\t%s\n' % (lang, pid, code, loc, err))
        if err:
            errs += 1
            if errs <= 3:
                sys.stderr.write('ERR %s %s: %s\n' % (lang, pid, err))
print('probed %d, errors %d' % (len(jobs), errs))
