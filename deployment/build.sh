#!/bin/bash

cd "$(dirname "$0")/.." || exit 1
clear

# ===============================================
# v2.1  Noona Stack Builder
#       Supports Group + Single Image Builds
#       Auto-installs missing node_modules
# ===============================================

# ────── Config ─────────────────────────────
declare -A GROUP_TARGETS=(
    ["all"]="warden portal vault moon sage raven oracle"
    ["core"]="warden portal vault moon"
    ["node"]="warden portal vault moon sage"
    ["java"]="raven"
    ["python"]="oracle"
)

# ────── Check Dependencies ─────────────────
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
        echo "📦 Running install.sh to install missing dependencies..."
        bash deployment/install.sh <<< "1"
        echo ""
    fi
}

# ────── Prompt ─────────────────────────────
echo "==============================================="
echo " 🚧 Noona Stack Builder v2.1"
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

# ────── Build Group ────────────────────────
if [[ "$BUILD_MODE" == "1" ]]; then
    echo ""
    echo "Available Docker groups:"
    echo "----------------------------------------------"
    for key in "${!GROUP_TARGETS[@]}"; do
        echo " - $key"
    done
    echo ""
    read -rp "Enter the name of the Docker group to build: " TARGET_GROUP

    TARGETS=${GROUP_TARGETS[$TARGET_GROUP]}
    if [[ -z "$TARGETS" ]]; then
        echo "❌ Invalid build target group: $TARGET_GROUP"
        exit 1
    fi

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
        echo "----------------------------------------------"
        docker build -f "$DOCKERFILE" $CACHE_OPT -t "$IMAGE_NAME" .
    done

    if [[ "$TARGET_GROUP" == "core" || "$TARGET_GROUP" == "all" ]]; then
        echo ""
        read -rp "Do you want to start Noona-Warden now? (y/N): " START_WARDEN
        if [[ "$START_WARDEN" =~ ^[Yy]$ ]]; then
            echo ""
            echo "🚀 Launching Noona-Warden..."
            docker run --rm -it \
                -v /var/run/docker.sock:/var/run/docker.sock \
                --name noona-warden "${NAMESPACE}/noona-warden:${TAG}"
        fi
    fi

# ────── Build Single ───────────────────────
elif [[ "$BUILD_MODE" == "2" ]]; then
    echo ""
    echo "Available single service Dockerfiles:"
    echo "----------------------------------------------"
    for f in deployment/single/*.Dockerfile; do
        fname=$(basename "$f")
        echo " - ${fname%.Dockerfile}"
    done
    echo ""
    read -rp "Enter the name of the single service to build: " SERVICE

    DOCKERFILE="deployment/single/${SERVICE}.Dockerfile"
    IMAGE_NAME="${NAMESPACE}/noona-${SERVICE}:${TAG}"

    if [[ ! -f "$DOCKERFILE" ]]; then
        echo "❌ Dockerfile not found for service: $SERVICE"
        exit 1
    fi

    check_node_modules "$SERVICE"

    echo ""
    echo "🔨 Building image: $IMAGE_NAME"
    echo "----------------------------------------------"
    docker build -f "$DOCKERFILE" $CACHE_OPT -t "$IMAGE_NAME" .

else
    echo "❌ Invalid option. Please enter 1 or 2."
    exit 1
fi

echo ""
echo "✅ Build complete!"
