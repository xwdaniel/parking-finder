#!/usr/bin/env bash
# Step 0b — fetch residential ways (with tags) for the 5 candidate boroughs.
# Mirrors the Camden/WF pull from Step 0: highway=residential ways only.
# (macOS bash 3.2 — no associative arrays.)
set -eu

OVERPASS="https://overpass-api.de/api/interpreter"
OUT_DIR="$(cd "$(dirname "$0")" && pwd)"

PAIRS="haringey|London Borough of Haringey
tower_hamlets|London Borough of Tower Hamlets
islington|London Borough of Islington
hackney|London Borough of Hackney
newham|London Borough of Newham"

echo "$PAIRS" | while IFS='|' read -r key name; do
  out="$OUT_DIR/${key}_residential.json"
  echo ">>> $name -> $out"
  q="[out:json][timeout:120];
area[\"name\"=\"$name\"][\"admin_level\"=\"8\"]->.b;
(way[\"highway\"=\"residential\"](area.b););
out tags;"
  curl -sS -G "$OVERPASS" --data-urlencode "data=$q" -o "$out"
  n=$(grep -o '"type"' "$out" | wc -l | tr -d ' ')
  echo "    elements: $n"
  sleep 3
done
