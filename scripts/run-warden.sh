#!/usr/bin/env bash
set -euo pipefail

NETWORK_NAME="${1:-${NOONA_NETWORK:-noona-network}}"
CONTAINER_NAME="${2:-${WARDEN_CONTAINER_NAME:-noona-warden}}"
WARDEN_IMAGE="${3:-${WARDEN_IMAGE:-docker.darkmatterservers.com/the-noona-project/noona-warden:latest}}"
DEBUG_MODE="${4:-${DEBUG:-false}}"
DOCKER_SOCK_PATH="${5:-${DOCKER_SOCK_PATH:-}}"
WARDEN_PORT="${6:-${WARDEN_PORT:-4001}}"
NOONA_DATA_ROOT="${7:-${NOONA_DATA_ROOT:-}}"

if [[ -n "${DOCKER_SOCK_PATH}" ]]; then
  DOCKER_SOCK_PATH="${DOCKER_SOCK_PATH}"
else
  case "$(uname -s)" in
    CYGWIN*|MINGW*|MSYS*)
      DOCKER_SOCK_PATH='//./pipe/docker_engine'
      ;;
    *)
      DOCKER_SOCK_PATH='/var/run/docker.sock'
      ;;
  esac
fi

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "Creating Docker network '$NETWORK_NAME'..."
  docker network create "$NETWORK_NAME" >/dev/null
fi

echo "Starting $CONTAINER_NAME on port $WARDEN_PORT using $WARDEN_IMAGE..."

docker_args=(
  run
  -d
  --rm
  --name "$CONTAINER_NAME"
  --network "$NETWORK_NAME"
  -p "${WARDEN_PORT}:${WARDEN_PORT}"
  -v "${DOCKER_SOCK_PATH}:/var/run/docker.sock"
  -e "DEBUG=${DEBUG_MODE}"
)

if [[ -n "${NOONA_DATA_ROOT}" ]]; then
  docker_args+=(
    -e "NOONA_DATA_ROOT=${NOONA_DATA_ROOT}"
    -v "${NOONA_DATA_ROOT}:${NOONA_DATA_ROOT}"
  )
fi

docker_args+=("$WARDEN_IMAGE")

docker "${docker_args[@]}"
