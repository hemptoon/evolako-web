#!/bin/sh
# Gradi public/embed/evo-fx-<sha10>.js iz fx.js + evo-fx-init.js i štampa SRI (sha384) za Webflow.
set -e
cd "$(dirname "$0")/.."
cat site-embed/fx.js site-embed/evo-fx-init.js > /tmp/evo-fx.bundle.js
npx --yes terser@5 /tmp/evo-fx.bundle.js -c -m --comments '/^!/' -o /tmp/evo-fx.min.js
H=$(shasum -a 256 /tmp/evo-fx.min.js | cut -c1-10)
mkdir -p public/embed
cp /tmp/evo-fx.min.js "public/embed/evo-fx-$H.js"
echo "public/embed/evo-fx-$H.js"
echo "sha384-$(openssl dgst -sha384 -binary /tmp/evo-fx.min.js | openssl base64 -A)"
