#!/bin/bash

cd "$(dirname "$0")/.." || exit 1
clear

# ─────────────────────────────────────────────────────────────
# 🌙 Noona Stack Deploy Manager (v3.0)
# Combines install, build, and docs logic into one tool
# ─────────────────────────────────────────────────────────────

# Paths and Constants
BASE_PATH="$(pwd)"
DOCS_DIR="$BASE_PATH/docs"
CONFIG_FILE="$DOCS_DIR/jsdoc.json"
OUTPUT_DIR="$DOCS_DIR/web"
INSTALL_SERVICES=(
  "$BASE_PATH"
  "$BASE_PATH/services/portal"
  "$BASE_PATH/services/moon"
  "$BASE_PATH/services/vault"
  "$BASE_PATH/services/warden"
)

declare -A GROUP_TARGETS=(
  ["all"]="warden portal vault moon sage raven oracle"
  ["core"]="warden portal vault moon"
  ["node"]="warden portal vault moon sage"
  ["java"]="raven"
  ["python"]="oracle"
)

# ─────────────────────────────────────────────────────────────
# 📋 Menu
# ─────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────"
echo "🌙 Noona Stack Deploy Manager"
echo "────────────────────────────────────────────"
echo "Choose an action:"
echo "1) Install all npm dependencies"
echo "2) Uninstall (remove node_modules & lockfiles)"
echo "3) Generate JSDoc documentation"
echo "4) Clean docs/web output folder"
echo "5) Build Docker images"
read -p "Enter 1, 2, 3, 4 or 5: " OPTION

# ─────────────────────────────────────────────────────────────
# ⚙️ Functions
# ─────────────────────────────────────────────────────────────
install_node_23() {
  echo "📦 Installing/Upgrading to Node.js 23..."
  curl -fsSL https://deb.nodesource.com/setup_23.x | sudo -E bash -
  sudo apt install -y nodejs
  echo "✅ Node.js 23 installed!"
}

check_node_modules() {
  local services=("$@")
  local missing=false
  for service in "${services[@]}"; do
    if [[ -d "services/$service" && ! -d "services/$service/node_modules" ]]; then
      echo "⚠️  node_modules missing for: $service"
      missing=true
    fi
  done
  if [[ "$missing" == true ]]; then
    echo ""
    echo "📦 Installing missing dependencies..."
    for dir in "${INSTALL_SERVICES[@]}"; do
      echo "▶️ $dir"
      (cd "$dir" && [ -f package.json ] && npm install || echo "⚠️  Skipped: No package.json")
    done
  fi
}

# ─────────────────────────────────────────────────────────────
# 🎯 Actions
# ─────────────────────────────────────────────────────────────
case $OPTION in
  1)
    echo "📦 Installing npm dependencies..."
    for dir in "${INSTALL_SERVICES[@]}"; do
      echo "▶️ $dir"
      (cd "$dir" && [ -f package.json ] && npm install || echo "⚠️  Skipped: No package.json")
    done
    echo "✅ Installation complete!"
    ;;

  2)
    echo "🧹 Removing node_modules and lockfiles..."
    for dir in "${INSTALL_SERVICES[@]}"; do
      echo "🗑️ $dir"
      (cd "$dir" && rm -rf node_modules package-lock.json)
    done
    echo "✅ Uninstall complete!"
    ;;

  3)
    echo "📚 Generating documentation with JSDoc..."

    if ! command -v node &> /dev/null; then
      echo "❌ Node.js is missing — attempting to install Node.js 23..."
      [[ "$OSTYPE" == "linux-gnu" ]] && install_node_23 || {
        echo "❌ Auto-install only works on Linux/WSL."
        echo "💡 Please install Node.js v23+ manually."
        exit 1
      }
    fi

    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 23 ]; then
      echo "⚠️ Detected Node.js v$NODE_VERSION — upgrading to v23..."
      [[ "$OSTYPE" == "linux-gnu" ]] && install_node_23 || {
        echo "❌ Auto-upgrade only works on Linux/WSL."
        exit 1
      }
    fi

    if ! command -v jsdoc &> /dev/null; then
      echo "📦 Installing JSDoc globally..."
      npm install -g jsdoc
    fi

    echo "📦 Running npm install for all services before generating docs..."
    for dir in "${INSTALL_SERVICES[@]}"; do
      echo "▶️ $dir"
      (cd "$dir" && [ -f package.json ] && npm install || echo "⚠️  Skipped: No package.json")
    done

    [ ! -f "$CONFIG_FILE" ] && {
      echo "❌ JSDoc config not found at $CONFIG_FILE"
      exit 1
    }

    mkdir -p "$OUTPUT_DIR"

    echo "📄 Running: jsdoc -c $CONFIG_FILE -d $OUTPUT_DIR services/portal services/vault services/moon services/warden"
    jsdoc -c "$CONFIG_FILE" -d "$OUTPUT_DIR" \
      services/portal \
      services/vault \
      services/moon \
      services/warden

    if [ "$(ls -A "$OUTPUT_DIR" 2>/dev/null)" ]; then
      echo "✅ Documentation generated at $OUTPUT_DIR"
    else
      echo "❌ JSDoc ran but output folder is empty. Check your config or source paths."
      exit 1
    fi

    [ -f "$OUTPUT_DIR/index.html" ] && {
      echo "🌐 Docs ready. Try opening: file://$OUTPUT_DIR/index.html"
    } || echo "⚠️ index.html not found. Something may have failed silently."
    ;;

  4)
    echo "🧼 Cleaning docs/web output..."
    [ -d "$OUTPUT_DIR" ] && rm -rf "$OUTPUT_DIR" && echo "✅ Removed: $OUTPUT_DIR" || echo "⚠️ Nothing to clean."
    ;;

  5)
    echo "==============================================="
    echo " 🚧 Noona Stack Builder"
    echo "==============================================="
    echo "Do you want to build a group or a single service?"
    echo "1) Group"
    echo "2) Single"
    read -rp "Enter 1 or 2: " BUILD_MODE
    echo ""

    read -rp "Enter the image tag [default: latest]: " TAG
    read -rp "Use --no-cache? (y/N): " NO_CACHE
    read -rp "Enter Docker namespace [default: captainpax]: " NAMESPACE

    TAG=${TAG:-latest}
    NAMESPACE=${NAMESPACE:-captainpax}
    CACHE_OPT=""
    [[ "$NO_CACHE" =~ ^[Yy]$ ]] && CACHE_OPT="--no-cache"

    if [[ "$BUILD_MODE" == "1" ]]; then
      echo ""
      echo "Available Docker groups:"
      for key in "${!GROUP_TARGETS[@]}"; do echo " - $key"; done
      echo ""
      read -rp "Enter the Docker group to build: " TARGET_GROUP

      TARGETS=${GROUP_TARGETS[$TARGET_GROUP]}
      [[ -z "$TARGETS" ]] && echo "❌ Invalid group: $TARGET_GROUP" && exit 1

      check_node_modules ${TARGETS[@]}

      for SERVICE in $TARGETS; do
        DOCKERFILE="deployment/single/${SERVICE}.Dockerfile"
        IMAGE_NAME="${NAMESPACE}/noona-${SERVICE}:${TAG}"

        if [[ ! -f "$DOCKERFILE" ]]; then
          echo "⚠️  Skipping: $SERVICE (missing Dockerfile)"
          continue
        fi

        echo ""
        echo "🔨 Building image: $IMAGE_NAME"
        docker build -f "$DOCKERFILE" $CACHE_OPT -t "$IMAGE_NAME" .
      done

      if [[ "$TARGET_GROUP" == "core" || "$TARGET_GROUP" == "all" ]]; then
        echo ""
        read -rp "Do you want to start Noona-Warden now? (y/N): " START_WARDEN
        [[ "$START_WARDEN" =~ ^[Yy]$ ]] && {
          echo "🚀 Launching Noona-Warden..."
          docker run --rm -it \
            -v /var/run/docker.sock:/var/run/docker.sock \
            --name noona-warden "${NAMESPACE}/noona-warden:${TAG}"
        }
      fi

    elif [[ "$BUILD_MODE" == "2" ]]; then
      echo ""
      echo "Available single service Dockerfiles:"
      for f in deployment/single/*.Dockerfile; do echo " - $(basename "$f" .Dockerfile)"; done
      echo ""
      read -rp "Enter the single service to build: " SERVICE

      DOCKERFILE="deployment/single/${SERVICE}.Dockerfile"
      IMAGE_NAME="${NAMESPACE}/noona-${SERVICE}:${TAG}"

      [[ ! -f "$DOCKERFILE" ]] && echo "❌ Dockerfile not found for service: $SERVICE" && exit 1

      check_node_modules "$SERVICE"

      echo ""
      echo "🔨 Building image: $IMAGE_NAME"
      docker build -f "$DOCKERFILE" $CACHE_OPT -t "$IMAGE_NAME" .

    else
      echo "❌ Invalid option. Please enter 1 or 2."
      exit 1
    fi
    ;;

  *)
    echo "❌ Invalid selection. Please choose 1–5."
    ;;
esac
