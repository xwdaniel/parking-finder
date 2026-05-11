#!/bin/bash
# Probe candidate URLs for each WF CPZ zone PDF.
# Output: lines of "ZONE_CODE<TAB>URL" for found PDFs (HTTP 200) or MISSING.

set -u

ZONES=(
  MW LSE VFR BL HH CHE HS HHN VA CH KS MH CTN WSE CF WSN LBR GGW GS BP
  OL AM BA LSW GGE LH FSR LNS WSC WSS QB LNN GM CHN LPW HF HHE MR LSN
  LPN FRN GGS CTS WA CML SJP FR HT CE HE ML HST BLN BWR LNW WXN LPE LNE
  WS BR TS GGN NC HPS WR LSS WD SNW LS MD MC RC CL LK SR TU RA TR FGN CG
  WXSw WXSe SBn SBs
)

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

PATTERNS=(
  "https://www.walthamforest.gov.uk/sites/default/files/2021-10/__Z__%20-%20CPZ%20Map.pdf"
  "https://www.walthamforest.gov.uk/sites/default/files/2021-10/__Z__%20CPZ%20Map.pdf"
  "https://www.walthamforest.gov.uk/sites/default/files/2021-11/__Z__%20-%20CPZ%20Map.pdf"
  "https://www.walthamforest.gov.uk/sites/default/files/2021-11/__Z__%20CPZ%20Map.pdf"
  "https://www.walthamforest.gov.uk/sites/default/files/2021-11/__Z__%20-%20CPZ%20map.pdf"
  "https://www.walthamforest.gov.uk/sites/default/files/2021-10/__Z__%20-%20CPZ%20map.pdf"
)

for z in "${ZONES[@]}"; do
  found=""
  for pattern in "${PATTERNS[@]}"; do
    url="${pattern//__Z__/$z}"
    code=$(curl -sLo /dev/null -w "%{http_code}" --max-time 10 -A "$UA" "$url")
    if [ "$code" = "200" ]; then
      found="$url"
      break
    fi
  done
  if [ -n "$found" ]; then
    printf "%s\t%s\n" "$z" "$found"
  else
    printf "%s\tMISSING\n" "$z"
  fi
done
