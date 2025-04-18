#!/bin/bash

cd "$(dirname "$0")/.." || exit 1
clear

# ===============================================
# v1.3  Noona Stack Builder
#       Powered by captainpax
# ===============================================

declare -A GROUP_TARGETS
GROUP_TARGETS=(
    ["all"]="warden portal vault moon sage raven oracle"
    ["core"]="warden portal vault"
    ["node"]="warden portal vault moon sage"
    ["java"]="raven"
    ["python"]="oracle"
)

declare -A DOCKERFILE_MAP
DOCKERFILE_MAP=(
    ["warden"]="core"
    ["portal"]="core"
    ["vault"]="core"
    ["moon"]="node"
    ["sage"]="node"
    ["raven"]="java"
    ["oracle"]="python"
)

echo "==============================================="
echo " v1.3  Noona Stack Builder"
echo "       Powered by captainpax"
echo "==============================================="
echo ""
echo "Available Docker targets:"
echo "----------------------------------------------"
for target in "${!GROUP_TARGETS[@]}"; do
    echo " - $target"
done
echo ""

read -rp "Enter the name of the Dockerfile group to build: " TARGET_GROUP
read -rp "Enter the image tag [default: latest]: " TAG
read -rp "Use --no-cache? (y/N): " NO_CACHE
read -rp "Enter Docker namespace [default: captainpax]: " NAMESPACE

TAG=${TAG:-latest}
NAMESPACE=${NAMESPACE:-captainpax}
CACHE_OPT=""
[[ "$NO_CACHE" =~ ^[Yy]$ ]] && CACHE_OPT="--no-cache"

TARGETS=${GROUP_TARGETS[$TARGET_GROUP]}
if [[ -z "$TARGETS" ]]; then
    echo "❌ Invalid build target group: $TARGET_GROUP"
    exit 1
fi

for SERVICE in $TARGETS; do
    FILE_KEY="${DOCKERFILE_MAP[$SERVICE]}"
    DOCKERFILE="deployment/${FILE_KEY}.Dockerfile"
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

echo ""
echo "✅ Build complete!"
