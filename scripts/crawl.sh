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
  # Normalise the list before wget sees it, for two reasons proven by
  # crawl.log:
  #  * The shop emits absolute https://<host>/... references (canonicals, the
  #    blog module, anything built with ssl=true, since domain_ssl is set).
  #    This crawl reaches the container over plain HTTP through /etc/hosts and
  #    nothing listens on 443, so every one of those was "Connection refused"
  #    on every pass, forever - 29 pages and 913 assets silently absent.
  #  * A reference containing whitespace is split by xargs into separate
  #    arguments, and wget then reports "unable to resolve host address 'du'".
  local clean="$list.clean"
  sed "s|^https://$HOST/|http://$HOST/|" "$list"     | grep -vE '[[:space:]]' | sort -u > "$clean"
  local dropped=$(( $(wc -l < "$list") - $(wc -l < "$clean") ))
  if [ "$dropped" -gt 0 ]; then
    echo "      (list normalised: $dropped line(s) dropped as malformed or merged)"
  fi
  xargs -a "$clean" -P "$JOBS" -n 10 wget \
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
  # A pass that fetches NOTHING repeats forever and the loop just ends,
  # leaving the export short with no stated reason - the wget errors go to
  # crawl.log, which nobody prints. Say it out loud instead.
  if [ "${prev2:-}" = "$n" ]; then
    echo "      ::error::pass $pass fetched nothing - still $n missing"
    echo "      --- first 5 URLs it could not get ---"
    head -5 todo.txt
    echo "      --- what wget said (last 20) ---"
    grep -aE 'ERROR|failed|unable|refused|Connecting' "$LOG" | tail -20
    break
  fi
  prev2="$n"
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
  if [ "${prev3:-}" = "$n" ]; then
    echo "      ::error::pass $pass fetched no assets - still $n missing"
    echo "      --- first 5 asset URLs it could not get ---"
    head -5 atodo.txt
    echo "      --- what wget said (last 20) ---"
    grep -aE 'ERROR|failed|unable|refused|Connecting' "$LOG" | tail -20
    break
  fi
  prev3="$n"
  fetch atodo.txt -nc
done

echo "   crawled: $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
echo "   wget errors in crawl.log: $(grep -acE 'ERROR|failed:' "$LOG" || true)"
