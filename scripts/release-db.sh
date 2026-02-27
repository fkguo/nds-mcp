#!/usr/bin/env bash
set -euo pipefail

# Build the NDS SQLite database and upload it to a GitHub Release.
#
# Usage:
#   ./scripts/release-db.sh --data-dir raw/ --tag v0.1.0
#   ./scripts/release-db.sh --data-dir raw/ --tag v0.1.0 --repo fkguo/nds-mcp
#
# Prerequisites:
#   - gh CLI authenticated
#   - pnpm / tsx available
#   - Raw data files in --data-dir

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR=""
TAG=""
REPO="fkguo/nds-mcp"
OUTPUT="$PKG_DIR/nds.sqlite"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --data-dir) DATA_DIR="$2"; shift 2 ;;
    --tag)      TAG="$2"; shift 2 ;;
    --repo)     REPO="$2"; shift 2 ;;
    --output)   OUTPUT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$DATA_DIR" || -z "$TAG" ]]; then
  echo "Usage: $0 --data-dir <dir> --tag <tag> [--repo <owner/repo>] [--output <path>]" >&2
  exit 1
fi

echo "=== Building NDS SQLite database ==="
echo "  Data dir: $DATA_DIR"
echo "  Output:   $OUTPUT"
echo ""

npx tsx "$PKG_DIR/src/ingest/buildDb.ts" --data-dir "$DATA_DIR" --output "$OUTPUT"

SIZE=$(du -h "$OUTPUT" | cut -f1)
echo ""
echo "Database built: $OUTPUT ($SIZE)"

# SHA256
if command -v shasum &>/dev/null; then
  SHA256=$(shasum -a 256 "$OUTPUT" | cut -d' ' -f1)
elif command -v sha256sum &>/dev/null; then
  SHA256=$(sha256sum "$OUTPUT" | cut -d' ' -f1)
else
  echo "Warning: no sha256 tool found, skipping checksum" >&2
  SHA256="(unknown)"
fi
echo "SHA256: $SHA256"

echo ""
echo "=== Uploading to GitHub Release ==="
echo "  Repo: $REPO"
echo "  Tag:  $TAG"

# Create release if it doesn't exist
if ! gh release view "$TAG" --repo "$REPO" &>/dev/null; then
  gh release create "$TAG" \
    --repo "$REPO" \
    --title "nds-mcp $TAG" \
    --notes "NDS SQLite database release.

**Database SHA256**: \`$SHA256\`
**Size**: $SIZE"
  echo "Release $TAG created."
else
  echo "Release $TAG already exists, uploading asset."
fi

# Upload (--clobber replaces existing asset)
gh release upload "$TAG" "$OUTPUT" --repo "$REPO" --clobber

echo ""
echo "=== Done ==="
echo "Download URL: https://github.com/$REPO/releases/download/$TAG/nds.sqlite"
echo "Latest URL:   https://github.com/$REPO/releases/latest/download/nds.sqlite"
