#!/bin/bash
# Run this script in the folder where you downloaded the COA PDFs from Google Drive.
# Usage: bash rename-coas.sh
# Usage (different folder): bash rename-coas.sh ~/Downloads/COAs

DIR="${1:-.}"

declare -A MAP=(
  ["5026_0274"]="tesamorelin-10mg"
  ["5026_0270"]="bpc-157-10mg"
  ["5026_0268"]="tb-500-10mg"
  ["5026_0266"]="klow-80mg"
  ["5026_0256"]="glow-70mg"
  ["5026_0260"]="mots-c-40mg"
  ["5026_0262"]="ghk-cu-50mg"
  ["5026_0264"]="igf-1lr3-1mg"
  ["5026_0250"]="cjc-1295-ipamorelin-no-dac-10mg"
  ["5026_0254"]="wolverine-10mg"
  ["5026_0248"]="nad-plus-1000mg"
  ["5026_0252"]="dsip-5mg"
)

renamed=0
skipped=0

for sample_id in "${!MAP[@]}"; do
  new_name="${MAP[$sample_id]}.pdf"
  # Find the original file containing the sample ID in its name
  match=$(find "$DIR" -maxdepth 1 -name "*${sample_id}*.pdf" 2>/dev/null | head -1)

  if [ -z "$match" ]; then
    echo "  SKIP  $sample_id — no matching file found"
    ((skipped++))
    continue
  fi

  dest="$DIR/$new_name"
  if [ -f "$dest" ]; then
    echo "  EXISTS $new_name — already renamed, skipping"
    ((skipped++))
    continue
  fi

  mv "$match" "$dest"
  echo "  OK    $(basename "$match") → $new_name"
  ((renamed++))
done

echo ""
echo "Done: $renamed renamed, $skipped skipped"
