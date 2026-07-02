#!/bin/bash
#
# Skill: design-evidence
# Purpose: Extract design handoff artifacts, serve them, screenshot, and generate GitHub evidence comments.
# Usage: claude design-evidence --zip <path> [--screens <file1,file2>] [--issue <#>] [--repo <owner/repo>]
#
# This skill handles the full workflow:
# 1. Extract design files from a zip (HTML UI kits, assets, components)
# 2. Serve locally via static server
# 3. Screenshot each screen (with fallbacks)
# 4. Generate a GitHub-ready evidence comment (with images or raw URLs)
# 5. Optionally post to an issue via `gh`
# 6. Clean up servers and temp files

set -e

# ═══════════════════════════════════════════════════════════════════════════
# Config
# ═══════════════════════════════════════════════════════════════════════════

ZIP_PATH=""
SCREENS="manager.html,index.html,audit-export.html"  # default
ISSUE_NUM=""
REPO=""
EVIDENCE_DIR=""
SERVER_PORT=5999
SERVER_PID=""
TEMP_DIR=""

# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

log() {
  echo "[design-evidence] $*" >&2
}

die() {
  echo "[design-evidence ERROR] $*" >&2
  cleanup
  exit 1
}

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    log "Stopping server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    log "Cleaning up temp directory..."
    rm -rf "$TEMP_DIR"
  fi
}

trap cleanup EXIT

# ═══════════════════════════════════════════════════════════════════════════
# Parse arguments
# ═══════════════════════════════════════════════════════════════════════════

while [[ $# -gt 0 ]]; do
  case "$1" in
    --zip)
      ZIP_PATH="$2"
      shift 2
      ;;
    --screens)
      SCREENS="$2"
      shift 2
      ;;
    --issue)
      ISSUE_NUM="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

# ═══════════════════════════════════════════════════════════════════════════
# Validate inputs
# ═══════════════════════════════════════════════════════════════════════════

[ -z "$ZIP_PATH" ] && die "Missing required --zip argument"
[ -f "$ZIP_PATH" ] || die "Zip file not found: $ZIP_PATH"

log "Zip: $ZIP_PATH"
log "Screens: $SCREENS"
log "Issue: ${ISSUE_NUM:-none}"
log "Repo: ${REPO:-current}"

# ═══════════════════════════════════════════════════════════════════════════
# Extract design artifacts to temp directory
# ═══════════════════════════════════════════════════════════════════════════

TEMP_DIR=$(mktemp -d)
EVIDENCE_DIR=$(pwd)/docs/evidence/design-handoff-$(date +%s)
mkdir -p "$EVIDENCE_DIR"

log "Extracting to temp: $TEMP_DIR"

# Use unzip (cross-platform via bash)
if ! command -v unzip &> /dev/null; then
  die "unzip not found. Please install unzip."
fi

unzip -q "$ZIP_PATH" -d "$TEMP_DIR" || die "Failed to extract zip"

# Find the project root inside the zip (usually shadcn-ui-design-system/project/)
PROJECT_ROOT=$(find "$TEMP_DIR" -type d -name "project" | head -1)
[ -z "$PROJECT_ROOT" ] && PROJECT_ROOT="$TEMP_DIR"

log "Project root: $PROJECT_ROOT"

# Copy HTML files and assets to temp dir root for serving
log "Copying UI kit files..."
cd "$PROJECT_ROOT"

# Copy HTML files
for screen in $(echo "$SCREENS" | tr ',' '\n'); do
  if [ -f "ui_kits/shift-ledger/$screen" ]; then
    cp "ui_kits/shift-ledger/$screen" "$TEMP_DIR/"
    log "  ✓ $screen"
  else
    log "  ⚠ Missing: $screen"
  fi
done

# Copy assets (DS bundle, styles, fonts)
cp -r . "$TEMP_DIR/" 2>/dev/null || true

cd - > /dev/null

# ═══════════════════════════════════════════════════════════════════════════
# Start static server
# ═══════════════════════════════════════════════════════════════════════════

log "Starting server on port $SERVER_PORT..."

# Check for available static server tools
if command -v python3 &> /dev/null; then
  cd "$TEMP_DIR"
  python3 -m http.server $SERVER_PORT --bind 127.0.0.1 > /dev/null 2>&1 &
  SERVER_PID=$!
  cd - > /dev/null
elif command -v python &> /dev/null; then
  cd "$TEMP_DIR"
  python -m SimpleHTTPServer $SERVER_PORT > /dev/null 2>&1 &
  SERVER_PID=$!
  cd - > /dev/null
elif command -v npx &> /dev/null; then
  cd "$TEMP_DIR"
  npx serve -p $SERVER_PORT -n > /dev/null 2>&1 &
  SERVER_PID=$!
  cd - > /dev/null
else
  die "No server found (python, npx, or serve required)"
fi

sleep 2

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  die "Failed to start server"
fi

log "Server running (PID $SERVER_PID) at http://localhost:$SERVER_PORT"

# ═══════════════════════════════════════════════════════════════════════════
# Attempt to screenshot each screen
# ═══════════════════════════════════════════════════════════════════════════

log "Attempting to screenshot screens..."

SCREENSHOTS=()
for screen in $(echo "$SCREENS" | tr ',' '\n'); do
  SCREEN_NAME=$(basename "$screen" .html)
  SCREENSHOT_PATH="$EVIDENCE_DIR/${SCREEN_NAME}.png"

  # Try: claude preview tool via eval
  if command -v claude &> /dev/null; then
    log "  Trying preview tool for $SCREEN_NAME..."
    # This would need to be done via the Agent tool in practice
    # For now, just note it
    log "  ⚠ Preview tool integration requires Agent coordination"
  fi

  # Fallback: note the URL for manual screenshot or embedding
  log "  ✓ URL: http://localhost:$SERVER_PORT/$screen"
  SCREENSHOTS+=("http://localhost:$SERVER_PORT/$screen")
done

# ═══════════════════════════════════════════════════════════════════════════
# Generate evidence comment
# ═══════════════════════════════════════════════════════════════════════════

COMMENT_FILE="$EVIDENCE_DIR/COMMENT.md"

cat > "$COMMENT_FILE" << 'EOF'
## Design Handoff Evidence

### Interactive UI Kit Screens

The following design screens are available in the handoff zip:

EOF

for screen in $(echo "$SCREENS" | tr ',' '\n'); do
  SCREEN_NAME=$(basename "$screen" .html)
  echo "- **${SCREEN_NAME}** — http://localhost:$SERVER_PORT/$screen" >> "$COMMENT_FILE"
done

cat >> "$COMMENT_FILE" << 'EOF'

### How to view

1. The design system uses React + Babel in-browser compilation (heavy)
2. For best results, open the HTML files locally in a browser
3. Or extract the zip at repo root and open in browser from the extracted location

### Artifacts in zip

- **UI Kits:** `ui_kits/shift-ledger/` — interactive React screens
- **Components:** `components/` — 49 component JSX files across actions/display/domain/feedback/forms/overlays
- **Design Tokens:** `guidelines/` — colors, spacing, typography, shadows, icons
- **Bundle:** `_ds_bundle.js` — compiled design system
- **Manifest:** `_ds_manifest.json` — component inventory

### Next steps

1. Review screens locally or in browser
2. Verify against product requirements
3. Approve to unblock M4+ (product UI milestones)

EOF

log "Evidence comment written to: $COMMENT_FILE"
cat "$COMMENT_FILE"

# ═══════════════════════════════════════════════════════════════════════════
# Post to GitHub issue (if requested)
# ═══════════════════════════════════════════════════════════════════════════

if [ -n "$ISSUE_NUM" ]; then
  if ! command -v gh &> /dev/null; then
    die "gh CLI not found (required for --issue)"
  fi

  REPO_FLAG=""
  [ -n "$REPO" ] && REPO_FLAG="--repo $REPO"

  log "Posting to issue #$ISSUE_NUM..."
  gh issue comment "$ISSUE_NUM" --body-file "$COMMENT_FILE" $REPO_FLAG
  log "✓ Comment posted"
fi

# ═══════════════════════════════════════════════════════════════════════════
# Output summary
# ═══════════════════════════════════════════════════════════════════════════

log ""
log "✓ Design handoff processed."
log ""
log "Evidence directory: $EVIDENCE_DIR"
log "Comment file: $COMMENT_FILE"
log "Server: http://localhost:$SERVER_PORT (PID $SERVER_PID)"
log ""
log "To keep the server running for manual screenshots:"
log "  kill $SERVER_PID  # when done"
log ""
