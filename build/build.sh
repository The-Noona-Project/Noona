#!/bin/bash

# ─────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────
USERNAME="captainpax"
PROJECT_NAME="Noona Stack Builder"
BUILD_DIR="$(dirname "$0")"
ROOT_DIR="$(cd "$BUILD_DIR/.." && pwd)"
DOCKERFILES=("$BUILD_DIR"/*.Dockerfile)

# ─────────────────────────────────────────────
# DISPLAY HEADER
# ─────────────────────────────────────────────
clear
echo
echo "==============================================="
echo "       $PROJECT_NAME v1.0"
echo "       Powered by $USERNAME"
echo "==============================================="
echo
echo "Available Docker targets:"
echo "----------------------------------------------"

index=1
OPTIONS=()
for df in "${DOCKERFILES[@]}"; do
    name=$(basename "$df")
    base="${name%%.Dockerfile}"
    echo "  $index) [$base] - $name"
    OPTIONS+=("$base")
    ((index++))
done
echo "  0) [Exit] - Quit"
echo "----------------------------------------------"
echo

# ─────────────────────────────────────────────
# PROMPT USER
# ─────────────────────────────────────────────
read -p "Select a target to build (name or number): " CHOICE
if [[ "$CHOICE" == "0" || "$CHOICE" == "exit" ]]; then
    echo "[EXIT] Goodbye."
    exit 0
fi

if [[ "$CHOICE" =~ ^[0-9]+$ ]]; then
    CHOICE="${OPTIONS[$((CHOICE-1))]}"
fi

read -p "Enter image tag (leave blank for 'latest'): " TAG
TAG=${TAG:-latest}

read -p "Use --no-cache? (y/n): " NOCACHE
[[ "$NOCACHE" == [yY] ]] && CACHE_FLAG="--no-cache" || CACHE_FLAG=""

DOCKERFILE="$BUILD_DIR/$CHOICE.Dockerfile"

if [[ ! -f "$DOCKERFILE" ]]; then
    echo "[ERROR] Dockerfile '$DOCKERFILE' not found."
    exit 1
fi

echo
echo "[BUILD] Building: $CHOICE → using $DOCKERFILE"
echo

# ─────────────────────────────────────────────
# TARGET SELECTION
# ─────────────────────────────────────────────
if [[ "$CHOICE" == "core" ]]; then
    targets=(noona-warden noona-portal noona-vault)
elif [[ "$CHOICE" == "all" ]]; then
    targets=(noona-warden noona-portal noona-vault noona-sage noona-moon noona-oracle noona-raven)
else
    targets=("noona-$CHOICE")
fi

# ─────────────────────────────────────────────
# BUILD LOOP
# ─────────────────────────────────────────────
for target in "${targets[@]}"; do
    echo "[BUILD] Building target: $target"
    docker build $CACHE_FLAG -t "$USERNAME/$target" -f "$DOCKERFILE" --target "$target" "$ROOT_DIR"
    if [[ $? -eq 0 ]]; then
        echo "[OK] Built $USERNAME/$target"
        docker tag "$USERNAME/$target:latest" "$USERNAME/$target:$TAG"
        echo "[DONE] Tagged as: $TAG"
    else
        echo "[FAIL] Docker build failed for $target"
    fi
    echo
done

# ─────────────────────────────────────────────
# OPTIONAL: START WARDEN
# ─────────────────────────────────────────────
if [[ " ${targets[@]} " =~ " noona-warden " ]]; then
    read -p "Would you like to start Noona-Warden now? (y/n): " START_WARDEN
    if [[ "$START_WARDEN" == [yY] ]]; then
        echo
        echo "[INFO] Starting Noona-Warden..."
        docker run -it --rm --name noona-warden -v /var/run/docker.sock:/var/run/docker.sock "$USERNAME/noona-warden:$TAG"
    else
        echo "[SKIPPED] Not starting Noona-Warden."
    fi
else
    echo "[INFO] Noona-Warden was not part of this build."
fi
