#!/usr/bin/env bash
# Rebuild every explanation chart: TLA+ -> TLC -> Mermaid -> Pele SVG.
set -euo pipefail
cd "$(dirname "$0")/../.."

jar="${TLA2TOOLS:-$HOME/.cache/statechart/tla2tools.jar}"
if [[ ! -f "$jar" ]]; then
  mkdir -p "$(dirname "$jar")"
  curl -fsSL -o "$jar" \
    https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
fi
echo "936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88  $jar" | sha256sum -c -

if [[ -z "${STATECHART:-}" ]]; then
  STATECHART=$(find "$HOME/.cursor/plugins" -path '*/skills/statechart/scripts/statechart' -type f 2>/dev/null | head -1 || true)
fi
if [[ -z "${STATECHART}" || ! -f "$STATECHART" ]]; then
  echo "Set STATECHART to the pstack statechart script (skills/statechart/scripts/statechart)." >&2
  exit 1
fi

export TLA2TOOLS="$jar"
export JAVA="${JAVA:-java}"

specs=(
  docs/charts/person-360/Person360.tla
  docs/charts/send-gates/SendGates.tla
  docs/charts/play-arbitration/PlayArbitration.tla
  docs/charts/learn-loop/LearnLoop.tla
)

for spec in "${specs[@]}"; do
  dir=$(dirname "$spec")
  out=$(mktemp -d)
  "$STATECHART" "$spec" --view "$dir/view.ts" --out "$out"
  cp "$out/chart.mmd" "$dir/chart.mmd"
  node docs/charts/render-svg.mjs "$dir/chart.mmd" "$dir/chart.svg"
  rm -rf "$out"
done
