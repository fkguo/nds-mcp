#!/usr/bin/env bash
# Download all TUNL energy level PDFs and extract text via pdftotext.
# Usage: bash scripts/download-tunl.sh
#
# Requires: curl, pdftotext (poppler-utils)
# Output: raw/tunl/{A}_{Element}_{Year}.txt

set -euo pipefail

TUNL_DIR="$(cd "$(dirname "$0")/.." && pwd)/raw/tunl"
BASE_URL="https://nucldata.tunl.duke.edu"
PROXY="${https_proxy:-${HTTPS_PROXY:-}}"

mkdir -p "$TUNL_DIR"

CURL_OPTS=(-sL --max-time 30 --retry 2)
if [[ -n "$PROXY" ]]; then
  CURL_OPTS+=(--proxy "$PROXY")
fi

downloaded=0
skipped=0
failed=0

download_one() {
  local key="$1" pdf_path="$2"
  local pdf_file="$TUNL_DIR/${key}.pdf"
  local txt_file="$TUNL_DIR/${key}.txt"

  if [[ -f "$txt_file" ]]; then
    skipped=$((skipped + 1))
    return
  fi

  if [[ ! -f "$pdf_file" ]]; then
    local url="${BASE_URL}${pdf_path}"
    echo -n "  $key ..."
    if ! curl "${CURL_OPTS[@]}" -o "$pdf_file" "$url"; then
      echo " FAILED (curl)"
      failed=$((failed + 1))
      rm -f "$pdf_file"
      return
    fi
    if ! file "$pdf_file" | grep -q PDF; then
      echo " FAILED (not PDF)"
      failed=$((failed + 1))
      rm -f "$pdf_file"
      return
    fi
  fi

  if pdftotext -layout "$pdf_file" "$txt_file" 2>/dev/null; then
    local lines
    lines=$(wc -l < "$txt_file")
    echo " OK ($lines lines)"
    downloaded=$((downloaded + 1))
  else
    echo " FAILED (pdftotext)"
    failed=$((failed + 1))
    rm -f "$txt_file"
  fi
}

# Nuclide → PDF path (from ELTables.shtml, excluding _EL.pdf ENSDF-derived)
# Format: key pdf_path
ENTRIES="
4_H_1992 /nucldata/HTML/A=4/04_01_1992.pdf
4_He_1992 /nucldata/HTML/A=4/04_03_1992.pdf
4_Li_1992 /nucldata/HTML/A=4/04_24_1992.pdf
5_He_2002 /nucldata/HTML/A=5/05_01_2002.pdf
5_Li_2002 /nucldata/HTML/A=5/05_03_2002.pdf
6_He_2002 /nucldata/HTML/A=6/06_01_2002.pdf
6_Li_2002 /nucldata/HTML/A=6/06_04_2002.pdf
6_Be_2002 /nucldata/HTML/A=6/06_14_2002.pdf
7_He_2002 /nucldata/HTML/A=7/07_01_2002.pdf
7_Li_2002 /nucldata/HTML/A=7/07_02_2002.pdf
7_Be_2002 /nucldata/HTML/A=7/07_07_2002.pdf
8_He_2004 /nucldata/HTML/A=8/08_01_2004.pdf
8_Li_2004 /nucldata/HTML/A=8/08_02_2004.pdf
8_Be_2004 /nucldata/HTML/A=8/08_09_2004.pdf
8_B_2004 /nucldata/HTML/A=8/08_15_2004.pdf
9_Li_2004 /nucldata/HTML/A=9/09_01_2004.pdf
9_Be_2004 /nucldata/HTML/A=9/09_02_2004.pdf
9_B_2004 /nucldata/HTML/A=9/09_13_2004.pdf
10_He_2004 /nucldata/HTML/A=10/10_01_2004.pdf
10_Be_2004 /nucldata/HTML/A=10/10_05_2004.pdf
10_B_2004 /nucldata/HTML/A=10/10_18_2004.pdf
11_Li_2012 /nucldata/HTML/A=11/11_01_2012.pdf
11_Be_2012 /nucldata/HTML/A=11/11_04_2012.pdf
11_B_2012 /nucldata/HTML/A=11/11_18_2012.pdf
11_C_2012 /nucldata/HTML/A=11/11_38_2012.pdf
11_N_2012 /nucldata/HTML/A=11/11_45_2012.pdf
12_Li_2017 /nucldata/HTML/A=12/12_01_2017.pdf
12_Be_2017 /nucldata/HTML/A=12/12_02_2017.pdf
12_B_2017 /nucldata/HTML/A=12/12_05_2017.pdf
12_C_2017 /nucldata/HTML/A=12/12_13_2017.pdf
12_N_2017 /nucldata/HTML/A=12/12_44_2017.pdf
12_O_2017 /nucldata/HTML/A=12/12_52_2017.pdf
13_B_1991 /nucldata/HTML/A=13/13_01_1991.pdf
13_C_1991 /nucldata/HTML/A=13/13_04_1991.pdf
13_N_1991 /nucldata/HTML/A=13/13_14_1991.pdf
13_O_1991 /nucldata/HTML/A=13/13_21_1991.pdf
14_B_1991 /nucldata/HTML/A=14/14_01_1991.pdf
14_C_1991 /nucldata/HTML/A=14/14_03_1991.pdf
14_N_1991 /nucldata/HTML/A=14/14_10_1991.pdf
14_O_1991 /nucldata/HTML/A=14/14_22_1991.pdf
15_C_1991 /nucldata/HTML/A=15/15_01_1991.pdf
15_N_1991 /nucldata/HTML/A=15/15_04_1991.pdf
15_O_1991 /nucldata/HTML/A=15/15_16_1991.pdf
16_C_1993 /nucldata/HTML/A=16/16_02_1993.pdf
16_N_1993 /nucldata/HTML/A=16/16_05_1993.pdf
16_O_1993 /nucldata/HTML/A=16/16_13_1993.pdf
16_F_1993 /nucldata/HTML/A=16/16_30_1993.pdf
17_N_1993 /nucldata/HTML/A=17/17_02_1993.pdf
17_F_1993 /nucldata/HTML/A=17/17_23_1993.pdf
18_O_1995 /nucldata/HTML/A=18/18_09_1995.pdf
18_F_1995 /nucldata/HTML/A=18/18_24_1995.pdf
18_Ne_1995 /nucldata/HTML/A=18/18_36_1995.pdf
19_O_1995 /nucldata/HTML/A=19/19_02_1995.pdf
19_F_1995 /nucldata/HTML/A=19/19_09_1995.pdf
19_Ne_1995 /nucldata/HTML/A=19/19_27_1995.pdf
20_O_1998 /nucldata/HTML/A=20/20_02_1998.pdf
20_F_1998 /nucldata/HTML/A=20/20_05_1998.pdf
20_Ne_1998 /nucldata/HTML/A=20/20_17_1998.pdf
20_Na_1998 /nucldata/HTML/A=20/20_33_1998.pdf
"

echo "=== Downloading TUNL EL PDFs ==="
while IFS=' ' read -r key pdf_path; do
  [[ -z "$key" ]] && continue
  download_one "$key" "$pdf_path"
done <<< "$ENTRIES"

echo ""
echo "=== Summary ==="
echo "Downloaded + extracted: $downloaded"
echo "Skipped (already exist): $skipped"
echo "Failed: $failed"
echo "Total txt files: $(ls "$TUNL_DIR"/*.txt 2>/dev/null | wc -l)"
