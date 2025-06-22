#!/bin/bash

# deploy.sh — AIO manager for Noona Docker services
set -e

SERVICES=("moon" "warden" "raven" "oracle" "portal" "sage" "vault")
DOCKERHUB_USER="captainpax"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Noona Docker Manager ==="
read -p "Which service(s) to manage? (comma-separated or 'all'): " input

if [[ "$input" == "all" ]]; then
  SELECTED_SERVICES=("${SERVICES[@]}")
else
  IFS=',' read -ra SELECTED_SERVICES <<< "$input"
  for i in "${!SELECTED_SERVICES[@]}"; do
    SELECTED_SERVICES[$i]=$(echo "${SELECTED_SERVICES[$i]}" | xargs)
  done
fi

for SERVICE in "${SELECTED_SERVICES[@]}"; do
  IMAGE_NAME="${DOCKERHUB_USER}/noona-${SERVICE}"
  LOCAL_TAG="noona-${SERVICE}"
  DOCKERFILE="${ROOT_DIR}/deployment/${SERVICE}.Dockerfile"

  echo ""
  echo "--- Managing ${SERVICE} ---"

  read -p "Build $SERVICE image? (y/N): " DO_BUILD
  if [[ "$DO_BUILD" == "y" ]]; then
    docker build -f "$DOCKERFILE" -t "$LOCAL_TAG" "$ROOT_DIR"
  fi

  read -p "Push $SERVICE to Docker Hub? (y/N): " DO_PUSH
  if [[ "$DO_PUSH" == "y" ]]; then
    docker tag "$LOCAL_TAG" "${IMAGE_NAME}:latest"
    docker push "${IMAGE_NAME}:latest"
  fi

  read -p "Run $SERVICE container? (y/N): " DO_RUN
  if [[ "$DO_RUN" == "y" ]]; then
    # Create noona-network if it doesn't exist
    docker network inspect noona-network >/dev/null 2>&1 || docker network create noona-network

    docker run -d \
      --name "$LOCAL_TAG" \
      --network noona-network \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -p 3000:3000 \
      "$IMAGE_NAME:latest"
  fi

  read -p "Cleanup (remove container and local image)? (y/N): " DO_CLEAN
  if [[ "$DO_CLEAN" == "y" ]]; then
    docker rm -f "$LOCAL_TAG" 2>/dev/null || true
    docker rmi "$LOCAL_TAG" 2>/dev/null || true
  fi
done

echo ""
echo "All tasks complete."
