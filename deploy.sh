#!/usr/bin/env bash
# Push the current web/ to the live demo.
#
#   https://davidkrleez-bit.github.io/planomix/
#
# Only web/ goes up, because only web/ is served. The training pipeline, the vision
# server and the model code stay in this repository. Everything the deployed page can
# hand a visitor is already in web/, so publishing exactly that folder exposes nothing
# the live site does not.
#
# Photo reading is deliberately absent from the deployed build: it calls a model through
# the local `claude` CLI, so it needs server.py. The app says so when asked there.
#
# Usage:  ./deploy.sh ["commit message"]
set -euo pipefail

REPO=davidkrleez-bit/planomix
URL=https://davidkrleez-bit.github.io/planomix/
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/web"
MSG="${1:-Update the live demo}"

command -v gh >/dev/null || { echo "gh is not installed"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not logged in; run: gh auth login"; exit 1; }
[ -f "$SRC/index.html" ] || { echo "no web/index.html next to this script"; exit 1; }
for f in data/store.json data/surface.json data/validation.json; do
  [ -f "$SRC/$f" ] || { echo "missing web/$f - run: python model/pipeline.py && python model/make_store.py"; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone -q --depth 1 "https://github.com/$REPO.git" "$WORK/site"

# Replace the site's contents wholesale, so a file deleted here is deleted there too.
# The README is the deploy repo's own and is not shipped from web/.
( cd "$WORK/site" && git ls-files -z | grep -zv '^README\.md$' | xargs -0 -r rm -f )
cp -r "$SRC/." "$WORK/site/"

cd "$WORK/site"
# Stage first, then ask. On Windows a checkout arrives with CRLF while these sources are
# LF, so the tree looks modified until git normalises it on add; asking beforehand would
# report changes on every run and then fail on an empty commit.
git add -A
if git diff --cached --quiet; then
  echo "no changes; $URL is already current"
  exit 0
fi
git commit -q -m "$MSG"
git push -q origin main
echo "pushed. GitHub Pages rebuilds in about a minute:"
echo "  $URL"

for i in $(seq 1 18); do
  sleep 10
  s=$(gh api "repos/$REPO/pages" --jq .status 2>/dev/null || echo "?")
  [ "$s" = "built" ] && { echo "built"; exit 0; }
done
echo "still building; check: gh api repos/$REPO/pages --jq .status"
