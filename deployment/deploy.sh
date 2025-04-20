#!/bin/bash

cd "$(dirname "$0")/.." || exit 1
clear

# ─────────────────────────────────────────────────────────────
# 🌙 Noona Stack Deploy Manager (v4.2)
# ─────────────────────────────────────────────────────────────

BASE_PATH="$(pwd)"
DOCS_CONFIG="$BASE_PATH/docs/jsdoc.json"
DOCS_OUTPUT="$BASE_PATH/docs"
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
# Functions
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

clean_before_build() {
  echo "🧼 Pre-build cleanup: node_modules, lockfiles, and docs"

  for dir in "${INSTALL_SERVICES[@]}"; do
    echo "🗑️ $dir"
    (cd "$dir" && rm -rf node_modules package-lock.json)
  done

  if [ -d "$DOCS_OUTPUT" ]; then
    rm -rf "$DOCS_OUTPUT"
    echo "✅ Docs folder removed."
  else
    echo "ℹ️ No docs folder to remove."
  fi

  echo "✅ Clean slate ready!"
}

# ─────────────────────────────────────────────────────────────
# Menu
# ─────────────────────────────────────────────────────────────
echo "────────────────────────────────────────────"
echo "🌙 Noona Stack Deploy Manager"
echo "────────────────────────────────────────────"
echo "Choose an action group:"
echo "1) 🔄 Update (install deps, generate docs)"
echo "2) 🏗️  Build Docker images"
echo "3) 🧼 Clean node_modules or docs"
read -rp "Enter 1, 2 or 3: " MAIN_OPTION
echo ""

case $MAIN_OPTION in
  1)
    echo "🔄 UPDATE MENU:"
    echo "1) Install all npm dependencies"
    echo "2) Generate JSDoc documentation"
    read -rp "Choose: " UPDATE_CHOICE

    case $UPDATE_CHOICE in
      1)
        echo "📦 Installing npm dependencies..."
        for dir in "${INSTALL_SERVICES[@]}"; do
          echo "▶️ $dir"
          (cd "$dir" && [ -f package.json ] && npm install || echo "⚠️  Skipped: No package.json")
        done
        echo "✅ Install complete!"
        ;;
      2)
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

        echo "📦 Running npm install before docs..."
        for dir in "${INSTALL_SERVICES[@]}"; do
          echo "▶️ $dir"
          (cd "$dir" && [ -f package.json ] && npm install || echo "⚠️  Skipped: No package.json")
        done

        [ ! -f "$DOCS_CONFIG" ] && {
          echo "❌ JSDoc config not found at $DOCS_CONFIG"
          exit 1
        }

        echo "📄 Running: jsdoc -c $DOCS_CONFIG -d $DOCS_OUTPUT"
        jsdoc -c "$DOCS_CONFIG" -d "$DOCS_OUTPUT" \
          services/portal \
          services/vault \
          services/moon \
          services/warden

        if [ "$(ls -A "$DOCS_OUTPUT" 2>/dev/null)" ]; then
          echo "✅ Docs generated at $DOCS_OUTPUT"
        else
          echo "❌ Docs folder is empty. Check jsdoc.json and sources."
          exit 1
        fi
        ;;
      *)
        echo "❌ Invalid selection."
        ;;
    esac
    ;;

  2)
    echo "🏗️  BUILD MENU:"
    echo "1) Build Docker group"
    echo "2) Build single Docker service"
    read -rp "Choose: " BUILD_CHOICE

    read -rp "Enter image tag [default: latest]: " TAG
    read -rp "Use --no-cache? (y/N): " NO_CACHE
    read -rp "Enter Docker namespace [default: captainpax]: " NAMESPACE

    TAG=${TAG:-latest}
    NAMESPACE=${NAMESPACE:-captainpax}
    CACHE_OPT=""
    [[ "$NO_CACHE" =~ ^[Yy]$ ]] && CACHE_OPT="--no-cache"

    clean_before_build

    case $BUILD_CHOICE in
      1)
        echo "Available groups:"
        for key in "${!GROUP_TARGETS[@]}"; do echo " - $key"; done
        read -rp "Enter group name: " TARGET_GROUP
        TARGETS=${GROUP_TARGETS[$TARGET_GROUP]}

        [[ -z "$TARGETS" ]] && echo "❌ Invalid group: $TARGET_GROUP" && exit 1

        GROUP_DOCKERFILE="deployment/group/${TARGET_GROUP}.Dockerfile"
        if [[ -f "$GROUP_DOCKERFILE" ]]; then
          IMAGE_NAME="${NAMESPACE}/noona-${TARGET_GROUP}:${TAG}"
          echo "🔨 Building group image: $IMAGE_NAME"
          docker build -f "$GROUP_DOCKERFILE" $CACHE_OPT -t "$IMAGE_NAME" .
        else
          echo "⚠️ No group Dockerfile for $TARGET_GROUP — building individual services..."
          check_node_modules ${TARGETS[@]}
          for SERVICE in $TARGETS; do
            DOCKERFILE="deployment/single/${SERVICE}.Dockerfile"
            IMAGE_NAME="${NAMESPACE}/noona-${SERVICE}:${TAG}"
            [[ ! -f "$DOCKERFILE" ]] && echo "⚠️  Skipping $SERVICE (no Dockerfile)" && continue
            echo "🔨 Building: $IMAGE_NAME"
            docker build -f "$DOCKERFILE" $CACHE_OPT -t "$IMAGE_NAME" .
          done
        fi
        ;;
      2)
        echo "Available services:"
        for f in deployment/single/*.Dockerfile; do echo " - $(basename "$f" .Dockerfile)"; done
        read -rp "Enter service name: " SERVICE

        DOCKERFILE="deployment/single/${SERVICE}.Dockerfile"
        IMAGE_NAME="${NAMESPACE}/noona-${SERVICE}:${TAG}"

        [[ ! -f "$DOCKERFILE" ]] && echo "❌ No Dockerfile for: $SERVICE" && exit 1

        check_node_modules "$SERVICE"
        echo "🔨 Building: $IMAGE_NAME"
        docker build -f "$DOCKERFILE" $CACHE_OPT -t "$IMAGE_NAME" .
        ;;
      *)
        echo "❌ Invalid selection."
        ;;
    esac
    ;;

  3)
    echo "🧼 CLEAN MENU:"
    echo "1) Remove node_modules & lockfiles"
    echo "2) Delete generated docs"
    read -rp "Choose: " CLEAN_CHOICE

    case $CLEAN_CHOICE in
      1)
        echo "🧹 Removing node_modules..."
        for dir in "${INSTALL_SERVICES[@]}"; do
          echo "🗑️ $dir"
          (cd "$dir" && rm -rf node_modules package-lock.json)
        done
        echo "✅ Clean complete!"
        ;;
      2)
        echo "🧼 Removing docs output..."
        if [ -d "$DOCS_OUTPUT" ]; then
          rm -rf "$DOCS_OUTPUT"
          echo "✅ Docs folder removed."
        else
          echo "⚠️ No docs folder to clean."
        fi
        ;;
      *)
        echo "❌ Invalid selection."
        ;;
    esac
    ;;

  *)
    echo "❌ Invalid action group."
    ;;
esac
