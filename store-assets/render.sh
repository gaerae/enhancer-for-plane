#!/bin/sh
# Render every store capture to a 1280x800 PNG beside its source, in both listing
# languages: screenshot-N-name.png (English) and screenshot-N-name.ko.png (Korean).
#
#   sh store-assets/render.sh            # captures and promo tiles, both languages
#   sh store-assets/render.sh 4          # just screenshot-4-*
#   sh store-assets/render.sh promo      # just the promo tiles
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

# Promo tiles are not 1280x800, so each carries its size in its filename
# (promo-<name>-<W>x<H>.html) and is rendered at exactly that. Same two languages.
if [ -z "$WHICH" ] || [ "$WHICH" = promo ]; then
  for src in "$DIR"/promo-*.html; do
    [ -f "$src" ] || continue
    base=${src%.html}
    size=${base##*-}                       # e.g. 1400x560
    W=${size%x*}; H=${size#*x}
    case $W$H in *[!0-9]*|"") echo "skip $(basename "$src") — no <W>x<H> in the name" >&2; continue ;; esac
    for lang in en ko; do
      case $lang in en) out=$base.png ;; *) out=$base.$lang.png ;; esac
      "$CHROME" --headless --disable-gpu --hide-scrollbars \
        --force-device-scale-factor=1 --window-size="$W,$H" \
        --screenshot="$out" "file://$src?lang=$lang" >/dev/null 2>&1
      echo "$(basename "$out")"
    done
  done
fi
[ "$WHICH" = promo ] && exit 0

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
