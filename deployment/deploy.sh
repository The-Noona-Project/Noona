#!/bin/bash

cd "$(dirname "$0")/.." || exit 1
START_TIME=$(date +%s)

# Colors
BOLD="\033[1m"
RESET="\033[0m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
BLUE="\033[34m"

# Flags
CI_MODE=false
NO_CACHE=true
GROUP=""
TAG="latest"
NAMESPACE="captainpax"

BASE_PATH="$(pwd)"
GLOBAL_PACKAGE="$BASE_PATH/deployment/package.json"
DOCS_CONFIG="$BASE_PATH/docs/jsdoc.json"
DOCS_OUTPUT="$BASE_PATH/docs"

# Define services that use Node.js
INSTALL_SERVICES=(warden portal vault moon)

# Dependency map: service -> dependencies
declare -A SERVICE_DEPS=(
  ["warden"]="dockerode js-yaml"
  ["portal"]="express axios discord.js"
  ["vault"]="express redis jsonwebtoken"
  ["moon"]="express"
)

# Group map
declare -A GROUP_TARGETS=(
  ["all"]="warden portal vault moon sage raven oracle"
  ["core"]="warden portal vault moon"
  ["node"]="warden portal vault moon sage"
  ["java"]="raven"
  ["python"]="oracle"
)

generate_package_for_service() {
  local service="$1"
  local deps="${SERVICE_DEPS[$service]}"

  echo -e "${BLUE}📦 Generating package.json for $service...${RESET}"

  jq -n \
    --arg name "noona-$service" \
    --arg deps "$deps" '
    {
      name: $name,
      version: "1.0.0",
      type: "module",
      dependencies: (
        $deps | split(" ") | map({ (.): "*" }) | add
      )
    }
    ' > "$BASE_PATH/services/$service/package.json"
}

clean_before_build() {
  echo -e "${YELLOW}🧼 Cleaning node_modules, lockfiles, and generated package.jsons...${RESET}"
  for service in "${INSTALL_SERVICES[@]}"; do
    echo "🗑️ /services/$service"
    rm -rf "$BASE_PATH/services/$service/node_modules"
    rm -f "$BASE_PATH/services/$service/package-lock.json"

    if grep -q "\"name\": \"noona-$service\"" "$BASE_PATH/services/$service/package.json" 2>/dev/null; then
      echo "🗑️ Removing generated package.json for $service"
      rm -f "$BASE_PATH/services/$service/package.json"
    fi
  done

  if [ -d "$DOCS_OUTPUT" ]; then
    echo -e "${YELLOW}🧽 Cleaning docs (excluding jsdoc.json)...${RESET}"
    find "$DOCS_OUTPUT" -mindepth 1 ! -name 'jsdoc.json' -exec rm -rf {} +
    echo "✅ Docs cleaned"
  fi

  echo -e "${GREEN}✅ Clean slate ready!${RESET}"
}

install_service_deps() {
  for service in "${INSTALL_SERVICES[@]}"; do
    generate_package_for_service "$service"
    echo -e "${BLUE}📥 Installing dependencies for $service...${RESET}"
    (cd "$BASE_PATH/services/$service" && npm install)
  done
}

build_group_images() {
  local group="$1"
  local tag="$2"
  local ns="$3"
  local cache_opt="$4"
  local targets="${GROUP_TARGETS[$group]}"

  echo -e "${BLUE}🔨 Building group: ${BOLD}${group}${RESET}"

  for service in $targets; do
    local file="deployment/single/${service}.Dockerfile"
    local image="${ns}/noona-${service}:${tag}"
    if [[ -f "$file" ]]; then
      echo -e "${BLUE}→ Building: $image${RESET}"
      docker build -f "$file" $cache_opt -t "$image" .
    else
      echo -e "${YELLOW}⚠️ Skipping $service (no Dockerfile)${RESET}"
    fi
  done

  echo -e "\n${GREEN}✅ All Docker images built successfully.${RESET}"
}

full_docker_clean() {
  echo -e "${YELLOW}🧹 Performing full Docker cleanup...${RESET}"
  docker ps -aq --filter "name=noona-" | xargs -r docker rm -f
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep "noona-" | while read -r line; do
    image_id=$(echo "$line" | awk '{print $2}')
    docker rmi -f "$image_id"
  done
  docker builder prune -f
  docker volume prune -f
  docker container prune -f
  docker image prune -f
  echo -e "${GREEN}✅ Docker cleanup complete.${RESET}"
}

start_warden() {
  echo -e "${BLUE}🚀 Starting Warden container with Docker socket...${RESET}"
  docker run -it --rm \
    -v /var/run/docker.sock:/var/run/docker.sock \
    --name noona-warden \
    "${NAMESPACE}/noona-warden:${TAG}"
  echo -e "${GREEN}✅ Warden container finished.${RESET}"
}

# CLI parsing
while [[ $# -gt 0 ]]; do
  case "$1" in
    --group) GROUP="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --no-cache) NO_CACHE=true; shift ;;
    --ci) CI_MODE=true; shift ;;
    --help)
      echo "Usage: deploy.sh [--group name] [--tag latest] [--namespace captainpax] [--no-cache] [--ci]"
      exit 0
      ;;
    *) echo -e "${RED}❌ Unknown option: $1${RESET}"; exit 1 ;;
  esac
done

# ─────────────────────────────────────────────
# Interactive CLI
# ─────────────────────────────────────────────
while true; do
  echo -e "${BOLD}────────────────────────────────────────────${RESET}"
  echo -e "${BOLD}🌙 Noona Stack Deploy Manager${RESET}"
  echo -e "${BOLD}────────────────────────────────────────────${RESET}"
  echo "1) 🔄 Update (install deps, generate docs)"
  echo "2) 🏗️ Build Docker images"
  echo "3) 🧼 Clean (node_modules or Docker)"
  echo "4) 🚀 Start Warden (with Docker socket)"
  echo "5) ❌ Exit"
  read -rp "Enter 1, 2, 3, 4 or 5: " MAIN_OPTION
  echo ""

  case $MAIN_OPTION in
    1)
      echo "1) Install npm dependencies"
      echo "2) Generate JSDoc"
      read -rp "Choose: " CHOICE
      if [[ "$CHOICE" == "1" ]]; then
        install_service_deps
      elif [[ "$CHOICE" == "2" ]]; then
        [[ ! -x "$(command -v jsdoc)" ]] && npm install -g jsdoc
        jsdoc -c "$DOCS_CONFIG" -d "$DOCS_OUTPUT" services/*
        echo -e "${GREEN}✅ Docs generated${RESET}"
      fi
      ;;
    2)
      echo "1) Build group"
      echo "2) Build single"
      read -rp "Choose: " BMODE
      read -rp "Enter tag [default: latest]: " input_tag
      read -rp "Use --no-cache? (y/N): " input_nc
      read -rp "Namespace [default: captainpax]: " input_ns

      [[ -n "$input_tag" ]] && TAG="$input_tag"
      [[ "$input_nc" =~ ^[Nn]$ ]] && NO_CACHE=false
      [[ -n "$input_ns" ]] && NAMESPACE="$input_ns"
      [[ "$NO_CACHE" == true ]] && CACHE_OPT="--no-cache" || CACHE_OPT=""

      clean_before_build
      install_service_deps

      if [[ "$BMODE" == "1" ]]; then
        echo "Available groups:"
        for key in "${!GROUP_TARGETS[@]}"; do echo " - $key"; done
        read -rp "Enter group name: " GROUP
        [[ -z "${GROUP_TARGETS[$GROUP]}" ]] && echo -e "${RED}Invalid group${RESET}" && continue
        build_group_images "$GROUP" "$TAG" "$NAMESPACE" "$CACHE_OPT"
      else
        echo "Available services:"
        for f in deployment/single/*.Dockerfile; do echo " - $(basename "$f" .Dockerfile)"; done
        read -rp "Enter service name: " SERVICE
        file="deployment/single/${SERVICE}.Dockerfile"
        [[ ! -f "$file" ]] && echo -e "${RED}No Dockerfile for $SERVICE${RESET}" && continue
        image="${NAMESPACE}/noona-${SERVICE}:${TAG}"
        generate_package_for_service "$SERVICE"
        echo -e "${BLUE}→ Building $image${RESET}"
        docker build -f "$file" $CACHE_OPT -t "$image" .
      fi
      ;;
    3)
      echo "1) Node.js clean (node_modules + lockfiles + package.json)"
      echo "2) Docker clean (containers, images, build cache)"
      read -rp "Choose: " CLEAN_CHOICE
      [[ "$CLEAN_CHOICE" == "1" ]] && clean_before_build
      [[ "$CLEAN_CHOICE" == "2" ]] && full_docker_clean
      ;;
    4) start_warden ;;
    5)
      echo -e "${BLUE}👋 Exiting. See you soon, Commander.${RESET}"
      exit 0
      ;;
    *) echo -e "${RED}Invalid selection${RESET}" ;;
  esac

  echo ""
  read -rp "↩️ Press enter to return to the main menu..."
done
