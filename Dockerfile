# ANC-branded NocoDB — overlay build for EasyPanel.
#
# Strategy: layer our ANC logos on top of the official nocodb/nocodb:latest
# image, replacing every nocodb*.png / nocodb*.svg / favicon / PWA icon with
# the ANC equivalent. Keeps backend identical, no monorepo rebuild needed.
#
# CSS overrides hide the FREE PLAN badge + Enterprise upsell pills that the
# official EE-built image bundles (we can't strip the JS conditionals without
# rebuilding nc-gui from source).
#
# EasyPanel: Source = GitHub khaledbashir/nocodb branch anc-rebrand,
#            Build  = Dockerfile (root)

FROM nocodb/nocodb:latest

# Stage ANC brand assets
COPY brand/anc-logo.png /tmp/anc/logo.png
COPY brand/anc-logo-icon.png /tmp/anc/logo-icon.png
COPY brand/anc-favicon.ico /tmp/anc/favicon.ico
COPY brand/anc-overrides.css /usr/src/app/docker/nc-gui/anc-overrides.css

# Replace every NocoDB-branded image inside the served nc-gui directory.
# The Nuxt build emits content-hashed filenames so we use globs.
RUN set -e \
 && find /usr/src/app/docker/nc-gui -type f \( -name "nocodb*.png" -o -name "full-logo*.png" \) -exec cp /tmp/anc/logo.png {} \; \
 && find /usr/src/app/docker/nc-gui -type f -name "nocodb*.svg" -delete \
 && find /usr/src/app/docker/nc-gui -type f -name "icon.png" -exec cp /tmp/anc/logo-icon.png {} \; \
 && find /usr/src/app/docker/nc-gui -type f -name "pwa-*.png" -exec cp /tmp/anc/logo-icon.png {} \; \
 && find /usr/src/app/docker/nc-gui -type f -name "apple-touch-icon*.png" -exec cp /tmp/anc/logo-icon.png {} \; \
 && find /usr/src/app/docker/nc-gui -type f -name "favicon*.ico" -exec cp /tmp/anc/favicon.ico {} \; \
 && cp /tmp/anc/favicon.ico /usr/src/app/docker/nc-gui/favicon.ico

# Inject our override stylesheet into every HTML page so the upsell elements
# get display:none + the brand color overrides apply. Idempotent.
RUN find /usr/src/app/docker/nc-gui -name "*.html" -type f \
    -exec sh -c 'grep -q "anc-overrides.css" "$0" || sed -i "s|</head>|<link rel=\"stylesheet\" href=\"/anc-overrides.css\"></head>|" "$0"' {} \;

EXPOSE 8080
