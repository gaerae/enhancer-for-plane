#!/bin/sh
# Render every store capture to a 1280x800 PNG beside its source, in both listing
# languages: screenshot-N-name.png (English) and screenshot-N-name.ko.png (Korean).
#
#   sh store-assets/render.sh            # all of them, both languages
#   sh store-assets/render.sh 4          # just screenshot-4-*
#
# Chrome is used headless rather than a screenshot tool so the result looks identical on
# any machine: same viewport, same device scale, no window chrome, no retina doubling.
#
# The bytes, though, are not reproducible — rendering the same unchanged page twice can
# produce a PNG a few bytes different, so `git status` may show captures as modified after
# a full run with nothing visibly changed. Re-render only what you actually changed
# (`render.sh 3`), and `git checkout -- store-assets/` to drop the rest.
set -eu

DIR=$(cd "$(dirname "$0")" && pwd)
CHROME=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
[ -x "$CHROME" ] || { echo "Chrome not found — set CHROME=/path/to/chrome" >&2; exit 1; }

WHICH=${1:-}
for src in "$DIR"/screenshot-${WHICH:-[0-9]}*.html; do
  base=${src%.html}
  for lang in en ko; do
    case $lang in
      en) out=$base.png ;;                     # the default listing keeps the plain name
      *)  out=$base.$lang.png ;;
    esac
    "$CHROME" --headless --disable-gpu --hide-scrollbars \
      --force-device-scale-factor=1 --window-size=1280,800 \
      --screenshot="$out" "file://$src?lang=$lang" >/dev/null 2>&1
    echo "$(basename "$out")"
  done
done
