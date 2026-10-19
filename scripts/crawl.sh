#!/bin/bash
# Crawl a PrestaShop into a static tree.  $1=output dir  $2=host  $3=page list
#
# --max-redirect=0 is not optional: wget follows a 302 and saves the body under
# the REQUESTED path, so one stale URL silently produces a misfiled page. Here a
# redirect fails loudly instead.
set -uo pipefail

OUT="$1"
HOST="$2"
PAGES="$3"
LOG="$OUT/../crawl.log"
JOBS=6

mkdir -p "$OUT"
: > "$LOG"

fetch() {
  local list="$1"; shift
  [ -s "$list" ] || { echo "   (nothing to fetch)"; return 0; }
  xargs -a "$list" -P "$JOBS" -n 10 wget \
      -x -nH -P "$OUT" --max-redirect=0 \
      --timeout=30 --tries=3 --waitretry=3 --no-check-certificate \
      -e robots=off --user-agent='Mozilla/5.0 (static-export)' \
      -nv -a "$LOG" "$@" || true
}

ondisk() {
  local u="$1" p="${u#http://$HOST/}"
  p="${p#https://$HOST/}"
  case "$u" in
    */)     echo "$OUT/${p}index.html" ;;
    *.html) echo "$OUT/${p}" ;;
    *)      echo "$OUT/${p}.html" ;;
  esac
}

echo "   phase 1: $(wc -l < "$PAGES") pages"
fetch "$PAGES" -E

echo "   phase 2: page-link closure"
for pass in 1 2 3 4; do
  python3 scripts/pages.py "$OUT" "$HOST" linked.txt >/dev/null
  : > todo.txt
  while read -r u; do
    [ -f "$(ondisk "$u")" ] || printf '%s\n' "$u" >> todo.txt
  done < linked.txt
  n=$(wc -l < todo.txt)
  echo "      pass $pass: $(wc -l < linked.txt) linked, $n not on disk"
  [ "$n" -eq 0 ] && break
  fetch todo.txt -E
done

echo "   phase 3: assets"
for pass in 1 2 3; do
  python3 scripts/extract.py "$OUT" "$HOST" assets.txt >/dev/null 2>&1
  : > atodo.txt
  while read -r u; do
    p="${u#http://$HOST/}"; p="${p#https://$HOST/}"
    [ -f "$OUT/$p" ] || printf '%s\n' "$u" >> atodo.txt
  done < assets.txt
  n=$(wc -l < atodo.txt)
  echo "      pass $pass: $(wc -l < assets.txt) referenced, $n missing"
  [ "$n" -eq 0 ] && break
  fetch atodo.txt -nc
done

echo "   crawled: $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
