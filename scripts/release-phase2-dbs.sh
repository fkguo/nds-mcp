#!/usr/bin/env bash
set -euo pipefail

# Upload prebuilt Phase 2 SQLite databases (jendl5.sqlite / exfor.sqlite) to a GitHub Release.
#
# Usage:
#   ./scripts/release-phase2-dbs.sh --tag v0.1.1 \
#     --jendl5 ~/.nds-mcp/jendl5.sqlite \
#     --exfor ~/.nds-mcp/exfor.sqlite
#
# Prerequisites:
#   - gh CLI authenticated

TAG=""
REPO="fkguo/nds-mcp"
JENDL5_DB=""
EXFOR_DB=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)    TAG="$2"; shift 2 ;;
    --repo)   REPO="$2"; shift 2 ;;
    --jendl5) JENDL5_DB="$2"; shift 2 ;;
    --exfor)  EXFOR_DB="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$TAG" ]]; then
  echo "Usage: $0 --tag <tag> [--repo <owner/repo>] --jendl5 <path> --exfor <path>" >&2
  exit 1
fi
if [[ -z "$JENDL5_DB" && -z "$EXFOR_DB" ]]; then
  echo "At least one of --jendl5/--exfor is required" >&2
  exit 1
fi

command -v gh >/dev/null || { echo "gh CLI not found" >&2; exit 1; }

sha256_file() {
  local file="$1"
  if command -v shasum &>/dev/null; then
    shasum -a 256 "$file" | cut -d' ' -f1
  elif command -v sha256sum &>/dev/null; then
    sha256sum "$file" | cut -d' ' -f1
  else
    echo "(unknown)"
  fi
}

note_lines=()
note_lines+=("Phase 2 database assets.")

if [[ -n "$JENDL5_DB" ]]; then
  [[ -f "$JENDL5_DB" ]] || { echo "jendl5 DB not found: $JENDL5_DB" >&2; exit 1; }
  note_lines+=("")
  note_lines+=("- jendl5.sqlite")
  note_lines+=("  - sha256: \`$(sha256_file "$JENDL5_DB")\`")
fi
if [[ -n "$EXFOR_DB" ]]; then
  [[ -f "$EXFOR_DB" ]] || { echo "exfor DB not found: $EXFOR_DB" >&2; exit 1; }
  note_lines+=("")
  note_lines+=("- exfor.sqlite")
  note_lines+=("  - sha256: \`$(sha256_file "$EXFOR_DB")\`")
fi

notes="$(printf "%s\n" "${note_lines[@]}")"

if ! gh release view "$TAG" --repo "$REPO" &>/dev/null; then
  gh release create "$TAG" \
    --repo "$REPO" \
    --title "nds-mcp $TAG" \
    --notes "$notes"
fi

if [[ -n "$JENDL5_DB" ]]; then
  gh release upload "$TAG" "$JENDL5_DB#jendl5.sqlite" --repo "$REPO" --clobber
fi
if [[ -n "$EXFOR_DB" ]]; then
  gh release upload "$TAG" "$EXFOR_DB#exfor.sqlite" --repo "$REPO" --clobber
fi

echo "Uploaded assets to $REPO@$TAG"
echo "Latest URLs:"
echo "  https://github.com/$REPO/releases/latest/download/jendl5.sqlite"
echo "  https://github.com/$REPO/releases/latest/download/exfor.sqlite"

