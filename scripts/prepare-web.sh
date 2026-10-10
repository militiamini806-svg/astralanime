#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WEB="$ROOT/www"

mkdir -p "$WEB/js" "$WEB/css" "$WEB/img"
cp "$ROOT/index.html" "$WEB/index.html"
cp "$ROOT/api.js" "$ROOT/app.js" "$ROOT/auth.js" \
  "$ROOT/downloads.js" "$ROOT/media-provider.js" \
  "$ROOT/store.js" "$ROOT/views.js" "$WEB/js/"
cp "$ROOT/app.css" "$WEB/css/app.css"
cp "$ROOT/img/app-icon.png" "$WEB/img/app-icon.png"
cp "$ROOT/icon-512.png" "$WEB/icon-512.png"
