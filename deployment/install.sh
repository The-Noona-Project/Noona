#!/bin/bash

# ─────────────────────────────────────────────────────────────
# 🛠️  Noona Stack Installer/Uninstaller Script
# Location: /deployment/install.sh
# Applies to: root + Node-based services
# ─────────────────────────────────────────────────────────────

# List of all target directories (relative to this script's location)
SERVICES=(
  ".."                         # Root: shared utilities
  "../services/portal"
  "../services/moon/frontend"
  "../services/moon/backend"
  "../services/vault"
  "../services/warden"
  "../services/sage"
)

# Print header
echo "────────────────────────────────────────────"
echo "🌙 Noona Stack Builder (npm installer)"
echo "────────────────────────────────────────────"
echo "Choose an action:"
echo "1) Install all npm dependencies"
echo "2) Uninstall (remove node_modules & lockfiles)"
read -p "Enter 1 or 2: " OPTION

# Perform action
case $OPTION in
  1)
    echo ""
    echo "📦 Installing npm dependencies..."
    for dir in "${SERVICES[@]}"; do
      if [[ -f "$dir/package.json" ]]; then
        echo "▶️ $dir"
        (cd "$dir" && npm install)
      fi
    done
    echo "✅ All npm installs complete."
    ;;
  2)
    echo ""
    echo "🧹 Cleaning up project folders..."
    for dir in "${SERVICES[@]}"; do
      if [[ -d "$dir" ]]; then
        echo "🔸 Cleaning $dir"
        rm -rf "$dir/node_modules"
        rm -f "$dir/package-lock.json"
        find "$dir" -type d -name "gen" -exec rm -rf {} +
      fi
    done
    echo "🗑️ Cleanup finished."
    ;;
  *)
    echo "❌ Invalid option. Please enter 1 or 2."
    exit 1
    ;;
esac
