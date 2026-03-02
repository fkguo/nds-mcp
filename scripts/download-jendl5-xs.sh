#!/usr/bin/env bash
set -euo pipefail

OUT="${1:-${HOME}/.nds-mcp/raw/jendl5-n-300K.tar.gz}"
URL="https://wwwndc.jaea.go.jp/ftpnd/ftp/JENDL/jendl5-n-300K.tar.gz"

mkdir -p "$(dirname "${OUT}")"
echo "[download-jendl5-xs] ${URL} -> ${OUT}"
curl -fSL "${URL}" -o "${OUT}"
echo "[download-jendl5-xs] done"
