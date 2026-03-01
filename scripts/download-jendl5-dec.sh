#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-${HOME}/.nds-mcp/jendl5-dec_upd5.tar.gz}"
URL="https://wwwndc.jaea.go.jp/ftpnd/ftp/JENDL/jendl5-dec_upd5.tar.gz"

mkdir -p "$(dirname "${OUT}")"
curl -fSL "${URL}" -o "${OUT}"
echo "Downloaded: ${OUT}"
