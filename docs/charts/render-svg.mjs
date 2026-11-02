// Renders a statechart Mermaid file to SVG with pele@1.9.0.
// Colors follow the pstack statechart theme. No image model is involved.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const css = `
.pele {
  --pele-bg: #ffffff;
  --pele-fg: #1c1c1c;
  --pele-muted: #656565;
  --pele-line: #808080;
  --pele-surface: #fcfcfc;
  --pele-surface-alt: #f1f1f1;
  --pele-border: #c9c9c9;
}
.pele .blue rect { fill: #c3e0ff; }
.pele .orange rect { fill: #f0d3bf; }
.pele .purple rect { fill: #e3d5ff; }
.pele .yellow rect { fill: #f0dcbf; }
.pele .teal rect { fill: #bfe3df; }
.pele .tan rect { fill: #e5d9ce; }
.pele .pink rect { fill: #ffcbe6; }
.pele .breaks rect {
  fill: #ffecee !important;
  stroke: #e72e3b !important;
  stroke-width: 2.5px !important;
}
.pele .breaks text {
  fill: #cd2834 !important;
}
.pele .mayBreak rect {
  fill: #fff3e6 !important;
  stroke: #e8730c !important;
  stroke-width: 2.5px !important;
}
.pele .mayBreak text {
  fill: #b85a06 !important;
}
.pele .bugPath rect {
  stroke: #1680f3 !important;
  stroke-width: 2.5px !important;
}
.pele .repeats rect {
  stroke: #9b35d6 !important;
  stroke-width: 2.5px !important;
  stroke-dasharray: 6 3;
}
@media (prefers-color-scheme: dark) {
  .pele {
    --pele-bg: #1f1f1f;
    --pele-fg: #f5f5f5;
    --pele-muted: #acacac;
    --pele-line: #939393;
    --pele-surface: #121212;
    --pele-surface-alt: #2c2c2c;
    --pele-border: #4e4e4e;
  }
  .pele .blue rect { fill: #1b3857; }
  .pele .orange rect { fill: #573117; }
  .pele .purple rect { fill: #3c2e57; }
  .pele .yellow rect { fill: #573d17; }
  .pele .teal rect { fill: #174641; }
  .pele .tan rect { fill: #3d3127; }
  .pele .pink rect { fill: #57233e; }
  .pele .breaks rect {
    fill: #2e2021 !important;
    stroke: #cf2b35 !important;
  }
  .pele .breaks text {
    fill: #ff6463 !important;
  }
  .pele .mayBreak rect {
    fill: #2e2619 !important;
    stroke: #d0700f !important;
  }
  .pele .mayBreak text {
    fill: #ffa257 !important;
  }
  .pele .bugPath rect {
    stroke: #116dd2 !important;
  }
  .pele .repeats rect {
    stroke: #9a3fcf !important;
  }
}
`;

const cache = path.join(
  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
  "statechart",
  "pele",
);

if (!fs.existsSync(path.join(cache, "node_modules", "pele", "package.json"))) {
  fs.mkdirSync(cache, { recursive: true });
  execFileSync(
    "npm",
    ["install", "--prefix", cache, "--no-audit", "--no-fund", "--save-exact", "pele@1.9.0"],
    { stdio: "inherit" },
  );
}

const require = createRequire(path.join(cache, "package.json"));
const { render, PeleError } = await import(pathToFileURL(require.resolve("pele")).href);

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error("usage: node docs/charts/render-svg.mjs CHART.mmd CHART.svg");
  process.exit(2);
}

const text = fs.readFileSync(src, "utf8");
let svg;
try {
  ({ svg } = render(text, { limit: 1_000_000, outputLimit: 8_000_000, maxEdges: 10_000 }));
} catch (error) {
  if (error instanceof PeleError) {
    console.error(text);
    console.error(error.message);
  }
  throw error;
}

const decorated = svg.replace(/<svg\b([^>]*)>/, (_full, attrs) => {
  let next = attrs;
  if (!/\bclass=/.test(next)) next += ' class="pele"';
  else if (!/\bpele\b/.test(next)) next = next.replace(/class="([^"]*)"/, 'class="$1 pele"');
  return `<svg${next}>\n<style>${css}</style>`;
});

fs.writeFileSync(dest, decorated);
console.log(`wrote ${dest} (${decorated.length} bytes)`);
