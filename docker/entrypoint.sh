#!/bin/sh
set -e
# Support Pterodactyl environment
if [ -d "/home/container" ]; then
    export HOME="/home/container"
    mkdir -p /home/container/data /home/container/storage /home/container/client/cache /home/container/client/cache_compressed 2>/dev/null || true

    # Default persistent paths inside /home/container for Pterodactyl
    export CONFIG_PATH="${CONFIG_PATH:-/home/container/data/config.json}"
    export STORAGE_LOCATION="${STORAGE_LOCATION:-/home/container/storage}"

    # Relink assets/cache to Pterodactyl persistent client directory
    rm -rf /app/assets/cache /app/assets/cache_compressed 2>/dev/null || true
    ln -sf /home/container/client/cache /app/assets/cache
    ln -sf /home/container/client/cache_compressed /app/assets/cache_compressed
fi

# Port mapping: Pterodactyl assigns SERVER_PORT, Meowcord expects PORT
if [ -n "${SERVER_PORT}" ] && [ -z "${PORT}" ]; then
    export PORT="${SERVER_PORT}"
fi

# Built-in WebRTC SFU support
if [ "${ENABLE_SFU}" = "true" ] || [ "${ENABLE_SFU}" = "1" ]; then
    if [ -x "/usr/local/bin/pion-sfu" ] && [ -z "${PION_SFU_BIN}" ]; then
        export PION_SFU_BIN="/usr/local/bin/pion-sfu"
    fi
fi

cd /app

# Handle Pterodactyl custom STARTUP command substitution
if [ -n "${STARTUP}" ] && [ -z "$1" ]; then
    MODIFIED_STARTUP=$(eval echo $(echo "${STARTUP}" | sed -e 's/{{/${/g' -e 's/}}/}/g'))
    echo ":/home/container$ ${MODIFIED_STARTUP}"
    exec /bin/sh -c "${MODIFIED_STARTUP}"
fi

case "${1:-server}" in
client)
    CLIENT_CACHE_DIR="/data/client"
    if [ -d "/home/container/client" ]; then
        CLIENT_CACHE_DIR="/home/container/client"
    fi
    mkdir -p "${CLIENT_CACHE_DIR}/cache" "${CLIENT_CACHE_DIR}/cache_compressed" 2>/dev/null || true

    if [ -f assets/cache/index.html ] && [ "$2" != "--force" ]; then
        echo "[client] using the cached client, run the client service with --force to fetch the current one"
    else
        bun scripts/client.js
    fi
    bun scripts/client-release.js --check
    bun scripts/e2ee-anchors.js
    bun scripts/clan-badges.js || echo "[client] warning: could not extract server tag badges from this client build"
    bun scripts/compress-client.js
    ;;
server)
    if [ ! -f assets/cache/index.html ]; then
        echo "[server] client cache is empty, generating client assets automatically..."
        /app/docker/entrypoint.sh client
    fi
    bun scripts/client-release.js --check
    bun scripts/e2ee-anchors.js
    bun scripts/docker-configure.js

    STATE_DIR="$(dirname "${CONFIG_PATH:-/data/state/config.json}")"
    mkdir -p "${STATE_DIR}" 2>/dev/null || true
    cd "${STATE_DIR}"
    exec bun /app/dist/bundle/start.js
    ;;
*)
    exec "$@"
    ;;
esac
