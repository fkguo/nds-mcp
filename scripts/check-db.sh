#!/usr/bin/env bash
set -euo pipefail

MAIN_DB="${NDS_DB_PATH:-${HOME}/.nds-mcp/nds.sqlite}"
JENDL5_DB="${NDS_JENDL5_DB_PATH:-${HOME}/.nds-mcp/jendl5.sqlite}"
EXFOR_DB="${NDS_EXFOR_DB_PATH:-${HOME}/.nds-mcp/exfor.sqlite}"

fail() {
  echo "[check-db] ERROR: $1" >&2
  exit 1
}

require_file() {
  local path="$1"
  local name="$2"
  [[ -f "${path}" ]] || fail "${name} DB not found: ${path}"
}

query_int() {
  local db="$1"
  local sql="$2"
  local value
  value="$(sqlite3 "${db}" "${sql}")"
  echo "${value}" | tr -d '[:space:]'
}

require_file "${MAIN_DB}" "main"
require_file "${JENDL5_DB}" "jendl5"
require_file "${EXFOR_DB}" "exfor"

main_meta="$(query_int "${MAIN_DB}" "SELECT COUNT(*) FROM nds_meta;")"
codata_constants="$(query_int "${MAIN_DB}" "SELECT COUNT(*) FROM codata_constants;")"
(( main_meta > 0 )) || fail "main DB has empty nds_meta"
(( codata_constants > 0 )) || fail "main DB has no CODATA constants"

jendl5_decays="$(query_int "${JENDL5_DB}" "SELECT COUNT(*) FROM jendl5_decays;")"
jendl5_radiation="$(query_int "${JENDL5_DB}" "SELECT COUNT(*) FROM jendl5_radiation;")"
(( jendl5_decays > 0 )) || fail "jendl5 DB has no decay rows"
(( jendl5_radiation > 0 )) || fail "jendl5 DB has no radiation rows"

exfor_entries="$(query_int "${EXFOR_DB}" "SELECT COUNT(*) FROM exfor_entries;")"
exfor_points="$(query_int "${EXFOR_DB}" "SELECT COUNT(*) FROM exfor_points;")"
(( exfor_entries > 0 )) || fail "exfor DB has no entry rows"
(( exfor_points > 0 )) || fail "exfor DB has no point rows"

echo "[check-db] ok"
echo "[check-db] main:    ${MAIN_DB} (nds_meta=${main_meta}, codata_constants=${codata_constants})"
echo "[check-db] jendl5:  ${JENDL5_DB} (decays=${jendl5_decays}, radiation=${jendl5_radiation})"
echo "[check-db] exfor:   ${EXFOR_DB} (entries=${exfor_entries}, points=${exfor_points})"
