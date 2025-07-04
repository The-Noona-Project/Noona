#!/bin/bash

# deploy.sh — AIO manager for Noona Docker services
set -e

# === CONFIG ===
DOCKERHUB_USER="captainpax"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICES=("moon" "warden" "raven" "sage" "vault")

# === COLORS ===
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

# === FUNCTIONS ===

print_header() {
  echo -e "${BOLD}${CYAN}"
  echo "=============================="
  echo "   🚀 Noona Docker Manager"
  echo "=============================="
  echo -e "${RESET}"
}

print_main_menu() {
  echo -e "${YELLOW}Select an action:${RESET}"
  echo "1) 🛠️  Build"
  echo "2) 📤 Push"
  echo "3) 📥 Pull"
  echo "4) ▶️  Start"
  echo "5) 🧹 Clean"
  echo "0) ❌ Exit"
  echo ""
}

print_services_menu() {
  echo -e "${YELLOW}Select a service:${RESET}"
  echo "0) All"
  for i in "${!SERVICES[@]}"; do
    printf "%d) %s\n" $((i+1)) "${SERVICES[$i]}"
  done
  echo ""
}

print_success() {
  echo -e "${GREEN}✅ $1${RESET}"
}

print_error() {
  echo -e "${RED}❌ $1${RESET}"
}

# === MAIN LOOP ===

while true; do
  print_header
  print_main_menu
  read -p "Enter choice: " main_choice

  if [[ "$main_choice" == "0" ]]; then
    echo -e "${CYAN}Goodbye!${RESET}"
    exit 0
  fi

  if ! [[ "$main_choice" =~ ^[1-5]$ ]]; then
    print_error "Invalid choice."
    continue
  fi

  print_services_menu
  read -p "Enter service choice: " svc_choice

  # Determine selected services
  if [[ "$svc_choice" == "0" ]]; then
    SELECTED_SERVICES=("${SERVICES[@]}")
  elif [[ "$svc_choice" =~ ^[1-9][0-9]*$ ]] && (( svc_choice >= 1 && svc_choice <= ${#SERVICES[@]} )); then
    SELECTED_SERVICES=("${SERVICES[$((svc_choice-1))]}")
  else
    print_error "Invalid service choice."
    continue
  fi

  for SERVICE in "${SELECTED_SERVICES[@]}"; do
    IMAGE_NAME="${DOCKERHUB_USER}/noona-${SERVICE}"
    LOCAL_TAG="noona-${SERVICE}"
    DOCKERFILE="${ROOT_DIR}/deployment/${SERVICE}.Dockerfile"

    echo -e "${CYAN}--- Managing ${SERVICE} ---${RESET}"

    case $main_choice in
      1) # Build
        echo -e "${YELLOW}🔨 Building ${SERVICE}...${RESET}"
        set +e
        docker build -f "$DOCKERFILE" -t "$LOCAL_TAG" "$ROOT_DIR"
        BUILD_EXIT=$?
        set -e
        if [ $BUILD_EXIT -ne 0 ]; then
          print_error "Build failed for ${SERVICE} (exit code $BUILD_EXIT)"
          exit $BUILD_EXIT
        else
          print_success "Build complete for ${SERVICE}"
        fi
        ;;
      2) # Push
        echo -e "${YELLOW}📤 Pushing ${SERVICE}...${RESET}"
        docker tag "$LOCAL_TAG" "${IMAGE_NAME}:latest"
        docker push "${IMAGE_NAME}:latest"
        print_success "Push complete for ${SERVICE}"
        ;;
      3) # Pull
        echo -e "${YELLOW}📥 Pulling ${SERVICE}...${RESET}"
        docker pull "${IMAGE_NAME}:latest"
        print_success "Pull complete for ${SERVICE}"
        ;;
      4) # Start
        echo -e "${YELLOW}▶️  Starting ${SERVICE}...${RESET}"
        docker network inspect noona-network >/dev/null 2>&1 || docker network create noona-network

        if [[ "$SERVICE" == "warden" ]]; then
          DEBUG_ENV="-e DEBUG=super"
        else
          DEBUG_ENV="-e DEBUG=false"
        fi

        docker run -d \
          --name "$LOCAL_TAG" \
          -v /var/run/docker.sock:/var/run/docker.sock \
          $DEBUG_ENV \
          "${IMAGE_NAME}:latest"

        print_success "${SERVICE} started."
        ;;
      5) # Clean
        echo -e "${YELLOW}🧹 Cleaning ${SERVICE}...${RESET}"
        docker rm -f "$LOCAL_TAG" 2>/dev/null || true
        docker rmi "$LOCAL_TAG" 2>/dev/null || true
        print_success "${SERVICE} cleaned."
        ;;
    esac
  done

  echo ""
  read -p "Return to main menu? (y/N): " again
  if [[ "$again" != "y" ]]; then
    echo -e "${CYAN}Goodbye!${RESET}"
    exit 0
  fi
done
