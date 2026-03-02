#!/usr/bin/env bash
set -euo pipefail

MAIN_DB="${NDS_DB_PATH:-${HOME}/.nds-mcp/nds.sqlite}"
JENDL5_DB="${NDS_JENDL5_DB_PATH:-${HOME}/.nds-mcp/jendl5.sqlite}"
EXFOR_DB="${NDS_EXFOR_DB_PATH:-${HOME}/.nds-mcp/exfor.sqlite}"
DDEP_DB="${NDS_DDEP_DB_PATH:-${HOME}/.nds-mcp/ddep.sqlite}"
ONLY_SCOPES=""

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

usage() {
  cat <<'EOF'
Usage:
  scripts/check-db.sh [--only main,jendl5,exfor,ddep]

Examples:
  scripts/check-db.sh
  scripts/check-db.sh --only main,jendl5
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --only)
      [[ $# -ge 2 ]] || fail "Missing value for --only"
      ONLY_SCOPES="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

CHECK_MAIN=1
CHECK_JENDL5=1
CHECK_EXFOR=1
CHECK_DDEP=1
if [[ -n "${ONLY_SCOPES}" ]]; then
  CHECK_MAIN=0
  CHECK_JENDL5=0
  CHECK_EXFOR=0
  CHECK_DDEP=0
  IFS=',' read -r -a scopes <<< "${ONLY_SCOPES}"
  for scope in "${scopes[@]}"; do
    case "${scope}" in
      main) CHECK_MAIN=1 ;;
      jendl5) CHECK_JENDL5=1 ;;
      exfor) CHECK_EXFOR=1 ;;
      ddep) CHECK_DDEP=1 ;;
      *) fail "Unknown scope in --only: ${scope}" ;;
    esac
  done
fi

if (( CHECK_MAIN )); then
  require_file "${MAIN_DB}" "main"
  main_meta="$(query_int "${MAIN_DB}" "SELECT COUNT(*) FROM nds_meta;")"
  codata_constants="$(query_int "${MAIN_DB}" "SELECT COUNT(*) FROM codata_constants;")"
  (( main_meta > 0 )) || fail "main DB has empty nds_meta"
  (( codata_constants > 0 )) || fail "main DB has no CODATA constants"
fi

if (( CHECK_JENDL5 )); then
  require_file "${JENDL5_DB}" "jendl5"
  jendl5_decays="$(query_int "${JENDL5_DB}" "SELECT COUNT(*) FROM jendl5_decays;")"
  jendl5_radiation="$(query_int "${JENDL5_DB}" "SELECT COUNT(*) FROM jendl5_radiation;")"
  jendl5_xs_meta="$(query_int "${JENDL5_DB}" "SELECT COUNT(*) FROM jendl5_xs_meta;")"
  jendl5_xs_points="$(query_int "${JENDL5_DB}" "SELECT COUNT(*) FROM jendl5_xs_points;")"
  jendl5_xs_interp="$(query_int "${JENDL5_DB}" "SELECT COUNT(*) FROM jendl5_xs_interp;")"
  (( jendl5_decays > 0 )) || fail "jendl5 DB has no decay rows"
  (( jendl5_radiation > 0 )) || fail "jendl5 DB has no radiation rows"
  (( jendl5_xs_meta > 0 )) || fail "jendl5 DB has no cross-section metadata rows"
  (( jendl5_xs_points > 0 )) || fail "jendl5 DB has no cross-section point rows"
  (( jendl5_xs_interp > 0 )) || fail "jendl5 DB has no cross-section interpolation rows"
fi

if (( CHECK_EXFOR )); then
  require_file "${EXFOR_DB}" "exfor"
  exfor_entries="$(query_int "${EXFOR_DB}" "SELECT COUNT(*) FROM exfor_entries;")"
  exfor_points="$(query_int "${EXFOR_DB}" "SELECT COUNT(*) FROM exfor_points;")"
  (( exfor_entries > 0 )) || fail "exfor DB has no entry rows"
  (( exfor_points > 0 )) || fail "exfor DB has no point rows"
fi

if (( CHECK_DDEP )); then
  require_file "${DDEP_DB}" "ddep"
  ddep_nuclides="$(query_int "${DDEP_DB}" "SELECT COUNT(*) FROM ddep_nuclides;")"
  ddep_lines="$(query_int "${DDEP_DB}" "SELECT COUNT(*) FROM ddep_radiation;")"
  (( ddep_nuclides > 0 )) || fail "ddep DB has no nuclide rows"
  (( ddep_lines > 0 )) || fail "ddep DB has no radiation rows"
fi

echo "[check-db] ok"
if (( CHECK_MAIN )); then
  echo "[check-db] main:    ${MAIN_DB} (nds_meta=${main_meta}, codata_constants=${codata_constants})"
fi
if (( CHECK_JENDL5 )); then
  echo "[check-db] jendl5:  ${JENDL5_DB} (decays=${jendl5_decays}, radiation=${jendl5_radiation}, xs_meta=${jendl5_xs_meta}, xs_points=${jendl5_xs_points}, xs_interp=${jendl5_xs_interp})"
fi
if (( CHECK_EXFOR )); then
  echo "[check-db] exfor:   ${EXFOR_DB} (entries=${exfor_entries}, points=${exfor_points})"
fi
if (( CHECK_DDEP )); then
  echo "[check-db] ddep:    ${DDEP_DB} (nuclides=${ddep_nuclides}, radiation=${ddep_lines})"
fi
