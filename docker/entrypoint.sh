#!/bin/sh
set -e

# Support Pterodactyl environment
if [ -d "/home/container" ]; then
    export HOME="/home/container"
    mkdir -p /home/container/data /home/container/storage /home/container/client/cache /home/container/client/cache_compressed 2>/dev/null || true

    # Default persistent paths inside /home/container for Pterodactyl
    export CONFIG_PATH="${CONFIG_PATH:-/home/container/data/config.json}"
    export STORAGE_LOCATION="${STORAGE_LOCATION:-/home/container/storage}"
    export CLIENT_CACHE_PATH="${CLIENT_CACHE_PATH:-/home/container/client/cache}"
    export CLIENT_COMPRESSED_PATH="${CLIENT_COMPRESSED_PATH:-/home/container/client/cache_compressed}"
    export PION_SFU_IPC="${PION_SFU_IPC:-/tmp/sfu.sock}"
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

CACHE_DIR="${CLIENT_CACHE_PATH:-assets/cache}"
COMPRESSED_DIR="${CLIENT_COMPRESSED_PATH:-assets/cache_compressed}"

case "${1:-server}" in
client)
    mkdir -p "${CACHE_DIR}" "${COMPRESSED_DIR}" 2>/dev/null || true
    if [ -f "${CACHE_DIR}/index.html" ] && [ "$2" != "--force" ]; then
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
    if [ ! -f "${CACHE_DIR}/index.html" ]; then
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
