# ANC-branded NocoDB — overlay + runtime JS patch for EasyPanel.
#
# CSS hide-by-class is fragile because the official EE-built image's
# minified JS rotates class names per release. We use a runtime JS patcher
# (brand/anc-overrides.js) that runs in the browser, watches DOM mutations,
# and removes any element with 'Enterprise' / 'Free Plan' / upsell text.
#
# This is robust against NocoDB UI changes — works regardless of which
# Tailwind class names get bundled.
#
# EasyPanel: Source = GitHub khaledbashir/nocodb branch anc-rebrand,
#            Build  = Dockerfile (root)

FROM nocodb/nocodb:latest

# Stage ANC brand assets at /usr/src/app/docker/nc-gui/ so they're served
# at the root path (the static-file root that Nuxt configured).
COPY brand/anc-logo.png /usr/src/app/docker/nc-gui/anc-logo.png
COPY brand/anc-logo-icon.png /usr/src/app/docker/nc-gui/anc-logo-icon.png
COPY brand/anc-favicon.ico /usr/src/app/docker/nc-gui/favicon.ico
COPY brand/anc-overrides.css /usr/src/app/docker/nc-gui/anc-overrides.css
COPY brand/anc-overrides.js /usr/src/app/docker/nc-gui/anc-overrides.js

# Replace every NocoDB-branded image inside the served nc-gui directory.
# Hashed Nuxt asset filenames so we use globs.
RUN set -e \
 && find /usr/src/app/docker/nc-gui -type f \( -name "nocodb*.png" -o -name "full-logo*.png" \) -exec cp /usr/src/app/docker/nc-gui/anc-logo.png {} \; \
 && find /usr/src/app/docker/nc-gui -type f -name "icon.png" -exec cp /usr/src/app/docker/nc-gui/anc-logo-icon.png {} \; \
 && find /usr/src/app/docker/nc-gui -type f -name "pwa-*.png" -exec cp /usr/src/app/docker/nc-gui/anc-logo-icon.png {} \; \
 && find /usr/src/app/docker/nc-gui -type f -name "apple-touch-icon*.png" -exec cp /usr/src/app/docker/nc-gui/anc-logo-icon.png {} \; \
 && find /usr/src/app/docker/nc-gui -type f -name "favicon*.ico" -exec cp /usr/src/app/docker/nc-gui/favicon.ico {} \;

# Inject our override stylesheet + JS patcher into every HTML page.
# JS runs on DOMContentLoaded + watches MutationObserver to scrub upsells.
RUN find /usr/src/app/docker/nc-gui -name "*.html" -type f -exec sh -c '\
    grep -q "anc-overrides.css" "$0" || sed -i "s|</head>|<link rel=\"stylesheet\" href=\"/anc-overrides.css\"></head>|" "$0"; \
    grep -q "anc-overrides.js" "$0" || sed -i "s|</head>|<script src=\"/anc-overrides.js\" defer></script></head>|" "$0"' {} \;

# Patch compiled NocoDB backend to set SameSite=None on auth/refresh cookies
# so the iframe at services.anc.com inherits ops.ancsports.net's session.
# NocoDB v2 builds the entire backend into /usr/src/app/docker/index.js. The
# upstream image is obfuscator-minified — three patterns appear in practice:
#   1) 'sameSite':'lax'                    (literal — quoted key)
#   2) 'sameSite':_0xabc(0x123,'xyz')      (obfuscator string-table lookup)
#   3) sameSite:'lax' / sameSite:"lax"     (unquoted key, kept for safety)
# All three are rewritten to 'none'. The grep at the end is a build-time
# sanity log so we can see in the build output that the patch landed.
RUN sed -i -E "s/'sameSite':'lax'/'sameSite':'none'/g; s/\"sameSite\":\"lax\"/\"sameSite\":\"none\"/g; s/'sameSite':_0x[a-z0-9_]+\(0x[a-f0-9]+,'[^']+'\)/'sameSite':'none'/g; s/sameSite:'lax'/sameSite:'none'/g; s/sameSite:\"lax\"/sameSite:\"none\"/g" /usr/src/app/docker/index.js \
 && echo "sameSite occurrences after patch:" \
 && grep -oE "[\"']?sameSite[\"']?:[^,;}]{1,40}" /usr/src/app/docker/index.js | sort -u || true

EXPOSE 8080
