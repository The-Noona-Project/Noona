#!/usr/bin/env bash
set -euo pipefail

NETWORK_NAME="${NOONA_NETWORK:-noona-network}"
CONTAINER_NAME="${WARDEN_CONTAINER_NAME:-noona-warden}"
WARDEN_IMAGE="${WARDEN_IMAGE:-captainpax/noona-warden:latest}"
WARDEN_PORT="${WARDEN_PORT:-4001}"
DEBUG_MODE="${DEBUG:-false}"
DOCKER_SOCK_PATH="${DOCKER_SOCK_PATH:-/var/run/docker.sock}"

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "Creating Docker network '$NETWORK_NAME'..."
  docker network create "$NETWORK_NAME" >/dev/null
fi

echo "Starting $CONTAINER_NAME on port $WARDEN_PORT using $WARDEN_IMAGE..."
docker run -d --rm \
  --name "$CONTAINER_NAME" \
  --network "$NETWORK_NAME" \
  -p "${WARDEN_PORT}:${WARDEN_PORT}" \
  -v "${DOCKER_SOCK_PATH}:/var/run/docker.sock" \
  -e "DEBUG=${DEBUG_MODE}" \
  "$WARDEN_IMAGE"
