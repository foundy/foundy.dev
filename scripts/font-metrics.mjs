// Prints metrics used to tune the size-adjusted fallback @font-face rules in tokens.css.
import * as fontkit from 'fontkit';

const base = 'node_modules/@fontsource-variable/';
const files = [
  ['schibsted-grotesk', 'schibsted-grotesk-latin-wght-normal.woff2'],
  ['jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2'],
];

for (const [pkg, file] of files) {
  const font = fontkit.openSync(`${base}${pkg}/files/${file}`);
  const u = font.unitsPerEm;
  const sample = 'abcdefghijklmnopqrstuvwxyz ';
  let w = 0;
  for (const g of font.layout(sample).glyphs) w += g.advanceWidth;
  console.log(pkg, {
    ascent: font.ascent / u,
    descent: font.descent / u,
    lineGap: font.lineGap / u,
    avgLowerWidth: w / sample.length / u,
  });
}
