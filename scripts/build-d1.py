"""Rebuild the D1 catalogue from the PrestaShop database in this runner.

Emits one .sql file that drops and repopulates every table the site's Pages
Functions read: the product/category tables, the canonical URL per product and
language, and the search index.

product_search carries two columns on purpose:
  title    = name + reference
  haystack = title + tags + descriptions + category names
`title`'s text is a PREFIX of `haystack`'s, so any title match is necessarily a
haystack match. One WHERE on haystack therefore finds everything, and title only
decides ordering - a name match outranks a product that merely sits in a
matching category.
"""
import html
import re
import subprocess
import sys

DB = sys.argv[1]
CANON = sys.argv[2]
OUT = sys.argv[3]
# --default-character-set=utf8mb4: the shop's text columns are latin1, so
# without it mysql hands back cp1252 bytes and this script died with
#   UnicodeDecodeError: 'utf-8' codec can't decode byte 0xae
# on the first product name containing a (R). d1.sql was then never
# written and the D1 rebuild was silently skipped.
MYSQL = ['mysql', '-h', '127.0.0.1', '-u', 'root', '-pshoproot',
         '--default-character-set=utf8mb4', '-N', '-B', DB, '-e']


def q(sql):
    """Rows as lists of strings. --batch escapes tabs/newlines as \\t and \\n;
    never pass --raw, which turns them back into real control characters and
    corrupts the column split."""
    # errors='replace' as a backstop: one undecodable byte must not take
    # the whole catalogue rebuild down.
    out = subprocess.run(MYSQL + [sql], capture_output=True, text=True,
                         encoding='utf-8', errors='replace')
    if out.returncode != 0:
        sys.stderr.write(out.stderr[:400])
        raise SystemExit('mysql failed')
    rows = []
    for line in out.stdout.split('\n'):
        if line.strip() == '':
            continue
        rows.append([None if c == 'NULL' else c for c in line.split('\t')])
    return rows


def lit(v):
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def strip_html(s):
    s = re.sub(r'<[^>]*>', ' ', s or '')
    s = html.unescape(s)
    return re.sub(r'\s+', ' ', s).strip()


stmts = []


def table(name, cols, rows, extra_ddl=''):
    stmts.append('DROP TABLE IF EXISTS %s;' % name)
    stmts.append('CREATE TABLE %s (%s);' % (name, cols))
    buf, size = [], 0
    for r in rows:
        v = '(' + ','.join(r) + ')'
        if size + len(v) > 8000 and buf:
            stmts.append('INSERT INTO %s VALUES %s;' % (name, ','.join(buf)))
            buf, size = [], 0
        buf.append(v)
        size += len(v) + 1
    if buf:
        stmts.append('INSERT INTO %s VALUES %s;' % (name, ','.join(buf)))
    if extra_ddl:
        stmts.append(extra_ddl)


langs = {r[0]: r[1] for r in q('SELECT id_lang, iso_code FROM ps_lang')}

table('products', 'id_product INTEGER PRIMARY KEY, active INTEGER, reference TEXT, id_image INTEGER',
      [[r[0], r[1], lit(r[2]), (r[3] or 'NULL')]
       for r in q('SELECT p.id_product, p.active, p.reference, '
                  '(SELECT i.id_image FROM ps_image i WHERE i.id_product=p.id_product AND i.cover=1 LIMIT 1) '
                  'FROM ps_product p')])

table('products_lang', 'id_product INTEGER, iso TEXT, name TEXT, description_short TEXT, link_rewrite TEXT',
      [[r[0], lit(langs.get(r[1], '')), lit(r[2]), lit(strip_html(r[3])), lit(r[4])]
       for r in q('SELECT id_product, id_lang, name, description_short, link_rewrite FROM ps_product_lang')
       if langs.get(r[1])])

table('categories', 'id_category INTEGER PRIMARY KEY, id_parent INTEGER, active INTEGER',
      [[r[0], r[1], r[2]] for r in q('SELECT id_category, id_parent, active FROM ps_category')])

table('categories_lang', 'id_category INTEGER, iso TEXT, name TEXT, link_rewrite TEXT',
      [[r[0], lit(langs.get(r[1], '')), lit(r[2]), lit(r[3])]
       for r in q('SELECT id_category, id_lang, name, link_rewrite FROM ps_category_lang')
       if langs.get(r[1])])

table('category_product', 'id_category INTEGER, id_product INTEGER, position INTEGER',
      [[r[0], r[1], r[2]] for r in q('SELECT id_category, id_product, position FROM ps_category_product')])

# canonical URLs, taken from the shop's own 302s during this run
urls = []
for line in open(CANON, encoding='utf-8'):
    p = line.rstrip('\n').split('\t')
    if len(p) >= 4 and p[3].endswith('.html') and 'controller=404' not in p[3]:
        path = re.sub(r'^https?://[^/]+', '', p[3])
        urls.append([p[1], lit(p[0]), lit(path)])
table('product_urls', 'id_product INTEGER, iso TEXT, url TEXT, PRIMARY KEY (id_product, iso)', urls,
      'CREATE INDEX idx_purl_iso ON product_urls(iso);')

# search index
tags = {}
for r in q('SELECT pt.id_product, pt.id_lang, t.name FROM ps_product_tag pt '
           'JOIN ps_tag t ON t.id_tag = pt.id_tag'):
    tags.setdefault((r[0], r[1]), []).append(r[2] or '')

cats = {}
for r in q('SELECT cp.id_product, cl.id_lang, cl.name FROM ps_category_product cp '
           'JOIN ps_category_lang cl ON cl.id_category = cp.id_category'):
    cats.setdefault((r[0], r[1]), []).append(r[2] or '')

search = []
for r in q('SELECT pl.id_product, pl.id_lang, pl.name, pl.description, pl.description_short, '
           'p.reference, p.active FROM ps_product_lang pl '
           'JOIN ps_product p ON p.id_product = pl.id_product'):
    iso = langs.get(r[1])
    if not iso:
        continue
    pid, name, desc, dshort, ref, active = r[0], r[2] or '', r[3] or '', r[4] or '', r[5] or '', r[6]
    title = (name + ' ' + ref).lower()
    hay = ' '.join([title] + tags.get((pid, r[1]), []) + [strip_html(dshort), strip_html(desc)]
                   + cats.get((pid, r[1]), [])).lower()
    search.append([pid, lit(iso), active, lit(title), lit(hay)])
table('product_search',
      'id_product INTEGER, iso TEXT, active INTEGER, title TEXT, haystack TEXT, PRIMARY KEY (id_product, iso)',
      search, 'CREATE INDEX idx_psearch ON product_search(iso, active);')

with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write('\n'.join(stmts) + '\n')
print('   d1: %d statements, largest %d bytes' % (len(stmts), max(len(s) for s in stmts)))
