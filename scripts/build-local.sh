#!/bin/bash
# =============================================================================
# Build Buntime for Local/Standalone Use
# =============================================================================
#
# Usage:
#   ./scripts/build-local.sh [destination]
#
# Examples:
#   ./scripts/build-local.sh              # Output to ./dist-local
#   ./scripts/build-local.sh ~/buntime    # Output to ~/buntime
#   ./scripts/build-local.sh /opt/buntime # Output to /opt/buntime
#
# Output structure:
#   <destination>/
#   ├── buntime              # Compiled binary
#   ├── apps/                # All apps (core + custom)
#   │   └── cpanel/
#   ├── plugins/             # All plugins (core + custom, without 'plugin-' prefix)
#   │   ├── database/
#   │   ├── gateway/
#   │   ├── keyval/
#   │   └── ...
#   └── .env                 # Configuration (edit as needed)
#
# After build:
#   1. Edit plugins/database/manifest.yaml to configure your database
#   2. Edit .env for runtime settings
#   3. Run: source .env && ./buntime
#
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="${1:-$ROOT_DIR/dist-local}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${GREEN}▸ $1${NC}"; }
step() { echo -e "${BLUE}━━━ $1 ━━━${NC}"; }

cd "$ROOT_DIR"

echo ""
step "Building Buntime for Local Use"
echo "Source:      $ROOT_DIR"
echo "Destination: $DEST"
echo ""

# 1. Clean destination
info "Preparing destination..."
rm -rf "$DEST"
mkdir -p "$DEST/apps" "$DEST/plugins" "$DEST/.cache/sqlite"

# 2. Build plugins
step "Building Plugins"
bun run --filter '@buntime/plugin-*' build

# 3. Build cpanel
step "Building CPanel"
bun run --filter '@buntime/cpanel' build

# 4. Build runtime binary
step "Building Runtime Binary"
cd apps/runtime
NODE_ENV=production bun scripts/build.ts --compile
cd "$ROOT_DIR"

# 5. Copy binary
info "Copying binary..."
cp apps/runtime/dist/buntime "$DEST/"
chmod +x "$DEST/buntime"

# 6. Copy enabled plugins (remove 'plugin-' prefix)
step "Copying Enabled Plugins"
for plugin in plugins/plugin-*/; do
  [ -d "$plugin" ] || continue
  full_name=$(basename "$plugin")
  short_name="${full_name#plugin-}"  # Remove 'plugin-' prefix
  enabled=$(grep -m1 "^enabled:" "$plugin/manifest.yaml" 2>/dev/null | awk '{print $2}')

  if [ "$enabled" = "true" ] && [ -d "$plugin/dist" ]; then
    echo -e "  ${GREEN}✓${NC} $short_name"
    mkdir -p "$DEST/plugins/$short_name"
    cp "$plugin/manifest.yaml" "$DEST/plugins/$short_name/"
    cp -r "$plugin/dist" "$DEST/plugins/$short_name/"
  else
    echo -e "  ${YELLOW}✗${NC} $short_name (disabled or no dist)"
  fi
done

# 7. Copy cpanel
step "Copying CPanel"
mkdir -p "$DEST/apps/cpanel"
cp apps/cpanel/manifest.yaml "$DEST/apps/cpanel/"
cp -r apps/cpanel/dist "$DEST/apps/cpanel/"
echo -e "  ${GREEN}✓${NC} cpanel"

# 8. Create .env
step "Creating .env"
cat > "$DEST/.env" << 'EOF'
# =============================================================================
# Buntime Local Configuration
# =============================================================================
# Usage: source .env && ./buntime
# =============================================================================

# Runtime
PORT=8000
RUNTIME_LOG_LEVEL=info
RUNTIME_POOL_SIZE=100
RUNTIME_API_PREFIX=/_
RUNTIME_WORKER_DIRS=./apps
RUNTIME_PLUGIN_DIRS=./plugins

# Gateway
# GATEWAY_SHELL_DIR=./apps/example-spa
GATEWAY_SHELL_EXCLUDES=cpanel
EOF

# 9. Summary
echo ""
step "Build Complete!"
echo ""
echo "Output: $DEST/"
echo ""
ls -la "$DEST/"
echo ""
echo "Apps:"
ls -1 "$DEST/apps/"
echo ""
echo "Plugins:"
ls -1 "$DEST/plugins/"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "  1. Configure database:"
echo "     ${BLUE}vim $DEST/plugins/database/manifest.yaml${NC}"
echo ""
echo "  2. Run:"
echo "     ${BLUE}cd $DEST && source .env && ./buntime${NC}"
echo ""
